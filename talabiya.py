"""
talabiya.py — builds the two daily order reports for one supplier owner (المسئول عن المورد):

    طلبية_<person>_<date>.xlsx    codes to order    (H/W + zero-stock items)
    تحويلات_<person>_<date>.xlsx  codes to transfer (small order, branches already hold plenty)

Inputs
    stock HTM   SofTech "all stock" export        -> main-warehouse stock (الرصيد المتاح)
    sales HTMs  SofTech "مبيعات فرع … خلال فترة"  -> sales qty per code, All Branches; period read from the header
    AppSheet CSV(s)                                -> how codes are linked, who owns each supplier, branch stock (الفروع)

Pure standard library: runs in any conda/python 3.8+ env, no installs.

Usage
    python talabiya.py                       # auto-find files in this folder, person = وصفى
    python talabiya.py --person "عصام"
    python talabiya.py --stock stock.htm --sales sales_1.htm salles_2.htm \
                       --sheet G:/all_my_websites/my_0_codes/AppSheet.ViewData.2026-10-24.csv
"""
import argparse, collections, csv, datetime, glob, html, math, os, re, sys, unicodedata, zipfile
from xml.sax.saxutils import escape

P = 'المسئول  عن المورد'           # note the double space — that's how the AppSheet header is spelled
HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_SHEET_DIR = r'G:\all_my_websites\my_0_codes'

# Codes the user confirmed are one item (other sizes / forms the sheet doesn't link). name, codes...
MANUAL_LINKS = """
GARAMYCIN CREAM 15/30 GM,117885,126375,109487,140704
MAG WHITES 30/60 TAB,140434,145513,127321,134833,121248,138199,140435
RAME-ZITHRO 200MG/5ML,119337,128128,145024,136433
QUOTE-FINE,146489,143749,138135
SATCHI,139348,139349
CICOL,142635,139639,111488,121945,133021
SANZAL,145129,141082,112320,123736,130603,137903,30818
WINTERREST,117763,121956,128230,130635,139103,145130,145810,5509,124996
U-RICHI FACE WASH NORMAL & DRY,140135,142381,122966,137474,136804,139981,142087,122967
U-RICHI FACE WASH OILY,122963,142080,137475,139916,122964,139689,139873,146142
VITALOX COMPLETE,145138,145084,141357,129734,141745,145370
ZITHRODOSE,110699,134620,110701,133679
DG-WASH FLUORIDE,93232,111364,146861,134689
DG-WASH MENTHOL,111363,146860,134688
DOLPHIN GEL,108393,126675,140569
PANOVEN CREAM,142661,121856,122950,138097,142363,137812
ASPROTECT 100,41148,123293,129973,73091,146567
FLAVICEF,129864,127036
BEEGU NOSE HYPERTONIC,131294,142452,127949,116836,121247,145053
ORAVERA,131253,131254
LAVASEPT,133606,142970
GARAMYCIN OINT 15/30,127131,146304
COMPLETE HAIR OIL,137755,120022,128673,132213,144150,143642,120024,132214
SOLO CREAM,145098,132295,145682,132292,144666,131000
"""

# ---------------------------------------------------------------- parsing
def n(s):
    if isinstance(s, (int, float)):
        return s
    return float((s or '0').replace(',', '').replace(' ', '') or 0)

def read(p):
    return open(p, encoding='utf-8-sig', errors='replace').read()

def html_rows(text):
    for r in re.findall(r'<TR>(.*?)</TR>', text, re.S):
        yield [x.strip() for x in re.findall(r'<TD[^>]*>(.*?)</TD>', r, re.S)]

def load_stock(p):
    stock = {}
    for t in html_rows(read(p)):
        if len(t) == 14 and t[13]:
            stock[t[13]] = dict(avail=n(t[7]), name=html.unescape(t[12]), sup=html.unescape(t[5]))
    return stock

def load_sales(p):
    """-> (qty per code, from-date, to-date). A report printed in the morning of its last day drops that day."""
    text = read(p)
    to, fr = [datetime.datetime.strptime(x, '%Y/%m/%d').date()
              for x in re.findall(r'>(\d{4}/\d{1,2}/\d{1,2})</TH>', text)[:2]]
    printed = re.search(r'(\d{1,2}):\d{2}\s+(\d{4}/\d{1,2}/\d{1,2})', text)
    if printed and int(printed.group(1)) < 12 and \
            datetime.datetime.strptime(printed.group(2), '%Y/%m/%d').date() == to:
        to -= datetime.timedelta(days=1)
    sold = collections.Counter()
    for t in html_rows(text):
        if len(t) == 7 and t[6].isdigit():
            sold[t[6]] += n(t[3])
    return sold, fr, to

def load_sheet(p):
    rows = list(csv.DictReader(open(p, encoding='utf-8-sig')))
    name_col = list(rows[0].keys())[3]
    for r in rows:
        r['_name'] = r[name_col]
    return rows

# ---------------------------------------------------------------- linking (تشغيلات / families)
TAG = re.compile(r'ت\.(?:ق|ج)\.?\d*')

def base(s):
    """Item name with price-generation tags and markers removed — same base = same تشغيلات group."""
    s = re.sub(r'كود\s*(?:جديد|اخر|قديم|ملغي)[^\d]*\d+', '', s)
    s = TAG.sub('', s)
    return re.sub(r'#\w#|ح\.ا|[\^~\s]', '', s).upper()

def gen(s):
    """Price generation: ت.ق=0, ت.ج=1, ت.جN=1+N, untagged=0. Highest = the active code."""
    m = re.findall(r'ت\.(ق|ج)\.?(\d?)', s)
    if not m:
        return 0
    a, b = m[-1]
    return 0 if a == 'ق' else 1 + (int(b) if b else 0)

def first_word(nm):
    w = re.findall(r'[A-Z]+', re.sub(r'#[^#]*#', ' ', nm).upper())
    return w[0] if w else nm

def strength(nm):
    s = re.sub(r'#[^#]*#|مثيل.*|بديل.*', ' ', nm.upper())
    return tuple(sorted(set(re.findall(r'(\d+(?:\.\d+)?)\s*(?:MG|MCG|IU)\b', s))))

def families(rows, min120=5):
    """code -> family id. A family = same name (تشغيلات) with the same sheet group values, merged with any
    group the sheet gives identical Order/120d/%change (same supplier, first word and strength)."""
    par = {}
    def find(x):
        while par.setdefault(x, x) != x:
            par[x] = par[par[x]]
            x = par[x]
        return x
    def uni(a, b):
        par[find(a)] = find(b)
    for r in rows:
        uni(r['code'], '|'.join(['N', base(r['_name']), r['الموردين'], r['Order'], r['بيع 120 يوم'], r['نسبة التغير']]))
    same = collections.defaultdict(list)
    for r in rows:
        if n(r['بيع 120 يوم']) >= min120 and r['نسبة التغير']:
            same[(r['الموردين'], r['Order'], r['بيع 120 يوم'], r['نسبة التغير'],
                  first_word(r['_name']), strength(r['_name']))].append(r['code'])
    for codes in same.values():
        for c in codes[1:]:
            uni(c, codes[0])
    return {r['code']: find(r['code']) for r in rows}

def manual_links(path):
    text = open(path, encoding='utf-8').read() if path else MANUAL_LINKS
    for line in text.splitlines():
        if line.strip() and not line.startswith('#'):
            yield [c.strip() for c in line.strip().split(',')[1:] if c.strip()]

# ---------------------------------------------------------------- xlsx (frozen header, centered, auto-fit, filter)
def write_xlsx(path, headers, rows, sheet):
    data = [headers] + [[r.get(h, '') for h in headers] for r in rows]
    width = lambda v: sum(2 if unicodedata.east_asian_width(ch) in 'WF' else 1 for ch in str(v))
    widths = [min(max(width(row[i]) for row in data) * 1.15 + 2, 100) for i in range(len(headers))]
    def col(i):
        s = ''
        while i >= 0:
            s = chr(65 + i % 26) + s
            i = i // 26 - 1
        return s
    def cell(ref, v, style):
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            return f'<c r="{ref}" s="{style}"><v>{v}</v></c>'
        return f'<c r="{ref}" s="{style}" t="inlineStr"><is><t xml:space="preserve">{escape(str(v))}</t></is></c>'
    last = f'{col(len(headers) - 1)}{len(data)}'
    sheet_xml = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
        '<cols>' + ''.join(f'<col min="{i+1}" max="{i+1}" width="{w:.1f}" customWidth="1"/>' for i, w in enumerate(widths)) + '</cols>'
        '<sheetData>' + ''.join(f'<row r="{ri+1}">' + ''.join(cell(f'{col(ci)}{ri+1}', v, 1 if ri == 0 else 2)
                                for ci, v in enumerate(row)) + '</row>' for ri, row in enumerate(data)) + '</sheetData>'
        f'<autoFilter ref="A1:{last}"/></worksheet>')
    styles = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
        '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
        '<borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="3"><xf/>'
        '<xf fontId="1" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>'
        '<xf applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf></cellXfs></styleSheet>')
    workbook = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        f'<sheets><sheet name="{escape(sheet)}" sheetId="1" r:id="rId1"/></sheets>'
        f'<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">\'{escape(sheet)}\'!$A$1:${col(len(headers)-1)}${len(data)}</definedName></definedNames></workbook>')
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>')
        z.writestr('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
        z.writestr('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>')
        z.writestr('xl/workbook.xml', workbook)
        z.writestr('xl/styles.xml', styles)
        z.writestr('xl/worksheets/sheet1.xml', sheet_xml)

# ---------------------------------------------------------------- finding inputs
def find_inputs(folder, stock, sales, sheets):
    """Fill in whatever wasn't passed: classify every .htm in `folder` by its content; newest AppSheet CSV."""
    if not stock or not sales:
        found_stock, found_sales = [], []
        for p in sorted(glob.glob(os.path.join(folder, '*.htm')) + glob.glob(os.path.join(folder, '*.html'))):
            head = open(p, encoding='utf-8-sig', errors='replace').read(6000)
            if 'خلال الفترة من' in head:
                found_sales.append(p)
            elif 'الرصيد المتاح' in head:
                found_stock.append(p)
        stock = stock or (max(found_stock, key=os.path.getmtime) if found_stock else None)
        sales = sales or found_sales
    if not sheets:
        cands = glob.glob(os.path.join(folder, 'AppSheet.ViewData.*.csv')) + \
                glob.glob(os.path.join(DEFAULT_SHEET_DIR, 'AppSheet.ViewData.*.csv'))
        sheets = [max(cands, key=lambda p: (re.findall(r'\d{4}-\d{2}-\d{2}', p) or [''])[-1])] if cands else []
    missing = [w for w, v in (('stock HTM', stock), ('sales HTM', sales), ('AppSheet CSV', sheets)) if not v]
    if missing:
        sys.exit('Missing input: ' + ', '.join(missing) + '. Pass it with --stock / --sales / --sheet.')
    return stock, sales, sheets

# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description='طلبية + تحويلات reports')
    ap.add_argument('--person', default='وصفى', help='المسئول عن المورد (default: وصفى)')
    ap.add_argument('--folder', default=os.getcwd(), help='where to look for inputs and write the reports')
    ap.add_argument('--stock', help='stock HTM (auto-detected if omitted)')
    ap.add_argument('--sales', nargs='+', help='sales HTMs (auto-detected if omitted)')
    ap.add_argument('--sheet', nargs='+', help='AppSheet CSV(s), newest first (default: newest AppSheet.ViewData.*.csv)')
    ap.add_argument('--links', help='manual links file: "name,code,code,..." per line (default: the list inside this script)')
    ap.add_argument('--date', default=datetime.date.today().isoformat(), help='date in the output file names')
    a = ap.parse_args()
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

    stock_p, sales_p, sheets = find_inputs(a.folder, a.stock, a.sales, a.sheet)
    print('stock :', stock_p)
    print('sales :', *sales_p)
    print('sheet :', *sheets)

    stock = load_stock(stock_p)

    sold, periods = collections.Counter(), []
    for p in sales_p:
        s, fr, to = load_sales(p)
        sold.update(s)
        periods.append((fr, to))
    days = sum((to - fr).days + 1 for fr, to in periods)
    k55 = 55 / days                                          # scale the period's sales to 55 days
    print('sales period:', ', '.join(f'{fr} → {to}' for fr, to in sorted(periods)), f'= {days} days')

    rows, seen = [], set()                                   # newest sheet wins; older ones fill missing codes
    for p in sheets:
        for r in load_sheet(p):
            if r['code'] not in seen:
                seen.add(r['code'])
                rows.append(r)
    fam_of = families(rows)
    sheet_row = {r['code']: r for r in rows}
    name2fam = {(base(r['_name']), r['الموردين']): fam_of[r['code']] for r in rows}
    sup2person = {}
    for r in reversed(rows):
        sup2person[r['الموردين']] = r[P]
    person_of = lambda c: sheet_row[c][P] if c in sheet_row else sup2person.get(stock[c]['sup'], '')

    groups = collections.defaultdict(list)                   # every stock code -> its item
    for c, h in stock.items():
        key = fam_of.get(c, name2fam.get((base(h['name']), h['sup']), ('N', base(h['name']), h['sup'])))
        groups[key].append(c)
    code2key = {c: k for k, v in groups.items() for c in v}
    for codes in manual_links(a.links):
        keys = []
        for c in codes:
            k = code2key.get(c)
            if k is not None and k in groups and k not in keys:
                keys.append(k)
        for k in keys[1:]:
            for c in groups.pop(k):
                groups[keys[0]].append(c)
                code2key[c] = keys[0]

    r5 = lambda x: 5 * math.floor(x / 5 + 0.5)               # round to nearest 5, halves up
    report = {}
    for codes in groups.values():
        act = max(codes, key=lambda c: (gen(stock[c]['name']), int(c)))
        if person_of(act) != a.person or re.search(r'#(?:B|C\.C|NA)#', stock[act]['name']):
            continue
        main_stock = sum(stock[c]['avail'] for c in codes)
        sales55 = round(sum(sold[c] for c in codes) * k55, 1)
        branches = sum(n(sheet_row[c]['الفروع']) for c in codes if c in sheet_row)
        order = r5(sales55 - main_stock)
        stock_lt_10_days = sales55 >= 20 and main_stock < sales55 / 55 * 10
        buy = sales55 >= 25 and main_stock <= 20
        sells_200 = sales55 > 200 and main_stock < 100
        zero_stock = main_stock <= 0 and order > 0 and sales55 / 55 * 30 > 5
        if stock_lt_10_days or buy or sells_200 or zero_stock:
            report[act] = {'code': act, 'اسم الصنف': stock[act]['name'], 'Order': order, 'الموردين': stock[act]['sup'],
                           'الرئيسي': round(main_stock, 3), 'بيع 55يوم': sales55, 'الفروع': branches}

    out = sorted(report.values(), key=lambda x: (x['الموردين'].casefold(), x['اسم الصنف'].casefold()))
    is_transfer = lambda r: 0 < r['Order'] < 20 and r['الفروع'] > 45
    transfers = [r for r in out if is_transfer(r)]
    orders = [r for r in out if not is_transfer(r)]

    f1 = os.path.join(a.folder, f'طلبية_{a.person}_{a.date}.xlsx')
    f2 = os.path.join(a.folder, f'تحويلات_{a.person}_{a.date}.xlsx')
    write_xlsx(f1, ['code', 'اسم الصنف', 'Order', 'الموردين', 'الرئيسي', 'بيع 55يوم'], orders, 'طلبية')
    write_xlsx(f2, ['code', 'اسم الصنف', 'Order', 'الموردين', 'الرئيسي', 'بيع 55يوم', 'الفروع'], transfers, 'تحويلات')
    print(f'طلبية   : {len(orders)} items, order {sum(r["Order"] for r in orders):,} -> {f1}')
    print(f'تحويلات : {len(transfers)} items, order {sum(r["Order"] for r in transfers):,} -> {f2}')

if __name__ == '__main__':
    main()

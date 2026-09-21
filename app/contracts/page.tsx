import { ContractsModes } from "@/components/contracts/contracts-modes";
import { hasFullAccess } from "@/lib/access";

// Contracts is the one page every signed-in user may use, so it carries no
// full-access guard. Full-access users additionally get the "Mr. Fahmy" sales
// analysis via the mode chooser; restricted users see only the normal tool.
export default async function Page() {
  const showFahmy = await hasFullAccess();
  return (
    <main className="mx-auto w-full max-w-[120rem] p-6 pb-64">
      <ContractsModes showFahmy={showFahmy} />
    </main>
  );
}

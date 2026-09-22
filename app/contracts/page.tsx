import { ContractsModes } from "@/components/contracts/contracts-modes";
import { canUseFahmy } from "@/lib/access";

// Contracts is the one page every signed-in user may use. The "Mr. Fahmy" mode
// is restricted to a small standalone allow-list (canUseFahmy) — everyone else
// sees only the normal contracts tool. This grants no other access.
export default async function Page() {
  const showFahmy = await canUseFahmy();
  return (
    <main className="mx-auto w-full max-w-[120rem] p-6 pb-64">
      <ContractsModes showFahmy={showFahmy} />
    </main>
  );
}

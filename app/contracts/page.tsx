import { ContractsModes } from "@/components/contracts/contracts-modes";

// Contracts is the one page every signed-in user may use. Both modes — the
// normal contracts tool and "Mr. Fahmy" — are available to everyone here.
export default function Page() {
  return (
    <main className="mx-auto w-full max-w-[120rem] p-6 pb-64">
      <ContractsModes showFahmy />
    </main>
  );
}

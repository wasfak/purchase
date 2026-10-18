import { requireFullAccess } from "@/lib/access";
import { FlyingStart } from "@/components/flying/flying-start";

export default async function Page() {
  await requireFullAccess();
  return <FlyingStart />;
}

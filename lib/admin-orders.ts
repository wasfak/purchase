import { clerkClient } from "@clerk/nextjs/server";

import { connectDB } from "@/lib/db";
import { Order } from "@/lib/models/Order";

// A flattened, fully-serializable order row for the admin dashboard, with the
// uploader resolved from a Clerk user id into a readable name + email.
export type AdminOrderRow = {
  _id: string;
  companyName: string;
  orderDay: string;
  dateOfDoing: string;
  inReview: string;
  sendDate: string;
  createdAt: string; // ISO string
  ownerId: string;
  uploaderName: string;
  uploaderEmail: string;
};

type Uploader = { name: string; email: string };

// Resolve a batch of Clerk user ids to { name, email } in one API call.
async function resolveUploaders(
  ownerIds: string[],
): Promise<Map<string, Uploader>> {
  const map = new Map<string, Uploader>();
  if (ownerIds.length === 0) return map;

  const client = await clerkClient();
  const { data } = await client.users.getUserList({
    userId: ownerIds,
    limit: Math.min(ownerIds.length, 500),
  });

  for (const u of data) {
    const email =
      u.emailAddresses.find((e) => e.id === u.primaryEmailAddressId)
        ?.emailAddress ??
      u.emailAddresses[0]?.emailAddress ??
      "";
    const name =
      [u.firstName, u.lastName].filter(Boolean).join(" ").trim() ||
      u.username ||
      email ||
      "Unknown";
    map.set(u.id, { name, email });
  }
  return map;
}

/** Every order in the system (admin view), newest first, with uploader info. */
export async function getAllOrdersWithUploaders(): Promise<AdminOrderRow[]> {
  await connectDB();
  const orders = await Order.find({}).sort({ createdAt: -1 }).lean();

  const ownerIds = [
    ...new Set(orders.map((o) => String(o.ownerId)).filter(Boolean)),
  ];
  const uploaders = await resolveUploaders(ownerIds);

  return orders.map((o) => {
    const uploader = uploaders.get(String(o.ownerId));
    return {
      _id: String(o._id),
      companyName: o.companyName ?? "",
      orderDay: o.orderDay ?? "",
      dateOfDoing: o.dateOfDoing ?? "",
      inReview: o.inReview ?? "",
      sendDate: o.sendDate ?? "",
      createdAt: o.createdAt ? new Date(o.createdAt).toISOString() : "",
      ownerId: String(o.ownerId),
      uploaderName: uploader?.name ?? "Unknown",
      uploaderEmail: uploader?.email ?? "",
    };
  });
}

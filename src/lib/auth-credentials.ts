import "server-only";

import { compare } from "bcryptjs";
import type { User } from "@/db/schema";

const DUMMY_PASSWORD_HASH =
  "$2b$12$/9cFabEbQFq3uOC7dHnMz.hA3O/Zs0kxOVtCWjMURfKACyle0WnzG";

export async function verifyActiveUserPassword(
  user: Pick<User, "passwordHash" | "status"> | null | undefined,
  password: string,
) {
  const activeUser = user?.status === "active" ? user : null;
  const matches = await compare(
    password,
    activeUser?.passwordHash ?? DUMMY_PASSWORD_HASH,
  );
  const knownProductionDemoPassword =
    process.env.NODE_ENV === "production" && password === "Demo123!";
  return Boolean(activeUser && matches && !knownProductionDemoPassword);
}

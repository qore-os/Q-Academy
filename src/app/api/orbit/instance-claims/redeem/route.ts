import { orbitClaimRedeemSchema } from "@/lib/orbit/schemas";
import { redeemOrbitInstanceClaim } from "@/lib/orbit/service";
import { handleSessionRequest, parseSessionJson, sessionData } from "@/lib/session-api";

export async function POST(request: Request) {
  return handleSessionRequest(
    request,
    { mutation: true, action: "orbit.instance_claim.redeem" },
    async (user) => {
      const input = orbitClaimRedeemSchema.parse(
        await parseSessionJson(request, { maxBytes: 1_024 }),
      );
      return sessionData(request, await redeemOrbitInstanceClaim(user, input), 201);
    },
  );
}


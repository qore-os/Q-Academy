import { z } from "zod";
import {
  acknowledgeAiTransparencyNotice,
  getAiTransparencyState,
} from "@/lib/ai/transparency";
import {
  handleSessionRequest,
  parseSessionJson,
  sessionData,
} from "@/lib/session-api";

export const dynamic = "force-dynamic";

const acknowledgementSchema = z
  .object({
    noticeDigest: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .strict();

export async function GET(request: Request) {
  return handleSessionRequest(
    request,
    { action: "ai.external_use.notice.read" },
    async (user) =>
      sessionData(
        request,
        await getAiTransparencyState({
          organizationId: user.organizationId,
          userId: user.id,
        }),
      ),
  );
}

export async function POST(request: Request) {
  return handleSessionRequest(
    request,
    { mutation: true, action: "ai.external_use.notice.acknowledge" },
    async (user) => {
      const input = acknowledgementSchema.parse(
        await parseSessionJson(request, { maxBytes: 512 }),
      );
      return sessionData(
        request,
        await acknowledgeAiTransparencyNotice({
          organizationId: user.organizationId,
          userId: user.id,
          expectedDigest: input.noticeDigest,
        }),
      );
    },
  );
}

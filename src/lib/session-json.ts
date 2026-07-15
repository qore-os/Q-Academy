import { ApiError } from "@/lib/api/errors";
import {
  BoundedJsonRequestError,
  parseBoundedJsonRequest,
} from "@/lib/bounded-json-request";

export async function parseSessionJson(
  request: Request,
  options: { maxBytes: number },
) {
  try {
    return await parseBoundedJsonRequest(request, {
      maxBytes: options.maxBytes,
      requireJsonContentType: true,
    });
  } catch (error) {
    if (!(error instanceof BoundedJsonRequestError)) throw error;
    switch (error.reason) {
      case "too_large":
        throw new ApiError(
          413,
          "bad_request",
          "Der Request-Body ist zu gross.",
        );
      case "invalid_content_type":
        throw new ApiError(
          400,
          "bad_request",
          "Content-Type muss application/json sein.",
        );
      case "missing_body":
        throw new ApiError(400, "bad_request", "Der Request-Body fehlt.");
      case "aborted":
        throw new ApiError(
          400,
          "bad_request",
          "Die Anfrage wurde abgebrochen.",
        );
      case "invalid_json":
        throw new ApiError(
          400,
          "bad_request",
          "Der Request-Body muss gueltiges JSON enthalten.",
        );
    }
  }
}

import type { Bundle, ZObject } from "zapier-platform-core";
import { apiUrl, type ApiEnvelope, type BundleOption } from "../api.js";

export async function listBundles(z: ZObject, bundle: Bundle) {
  const cursor = bundle.meta?.paging_token;
  const response = await z.request<ApiEnvelope<BundleOption[]>>({
    method: "GET",
    url: apiUrl(bundle, "/bundles"),
    params: {
      active: "true",
      limit: "100",
      sort: "name:asc",
      ...(cursor ? { cursor } : {}),
    },
  });
  return {
    results: response.data.data.map((item) => ({ id: item.id, label: item.name })),
    paging_token: response.data.meta?.pagination?.nextCursor ?? null,
  };
}

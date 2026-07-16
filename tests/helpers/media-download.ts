import {
  expect,
  type APIRequestContext,
  type APIResponse,
} from "@playwright/test";

type GetOptions = NonNullable<Parameters<APIRequestContext["get"]>[1]>;

export type MediaDownloadResult = {
  response: APIResponse;
  redirectLocation: string | null;
};

export async function fetchMediaDownload(
  request: APIRequestContext,
  href: string,
  options: GetOptions = {},
): Promise<MediaDownloadResult> {
  const initial = await request.get(href, {
    ...options,
    maxRedirects: 0,
  });
  if (initial.status() === 200 || initial.status() === 206) {
    return { response: initial, redirectLocation: null };
  }

  expect(initial.status()).toBe(307);
  const location = initial.headers().location;
  expect(location).toBeTruthy();

  const response = await request.get(location!);
  expect([200, 206]).toContain(response.status());
  return { response, redirectLocation: location! };
}

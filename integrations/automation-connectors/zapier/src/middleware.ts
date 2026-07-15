import type {
  AfterResponseMiddleware,
  BeforeRequestMiddleware,
} from "zapier-platform-core";

interface ProblemDetails {
  title?: string;
  detail?: string;
  code?: string;
}

export const addBearerHeader: BeforeRequestMiddleware = (request, _z, bundle) => {
  request.headers = request.headers ?? {};
  request.headers.Authorization = `Bearer ${bundle.authData.apiKey}`;
  return request;
};

export const exposeProblemDetails: AfterResponseMiddleware = (response, z) => {
  if (response.status < 400) return response;
  const problem = response.data as ProblemDetails | undefined;
  const message = problem?.detail ?? problem?.title ?? `Academy API returned HTTP ${response.status}.`;
  throw new z.errors.Error(message, problem?.code ?? "academy_api_error", response.status);
};

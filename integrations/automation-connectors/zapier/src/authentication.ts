import type { Authentication, Bundle, ZObject } from "zapier-platform-core";
import {
  apiUrl,
  connectorStatus,
  type ApiEnvelope,
  type ConnectorStatus,
  normalizeBaseUrl,
} from "./api.js";

const test = async (z: ZObject, bundle: Bundle) => {
  const response = await z.request<ApiEnvelope<ConnectorStatus>>({
    method: "GET",
    url: apiUrl(bundle, "/automation/connector-status"),
  });
  const status = connectorStatus(response.data.data);
  return {
    ...status,
    server: new URL(normalizeBaseUrl(bundle.authData.baseUrl)).host,
  };
};

const authentication = {
  type: "custom",
  fields: [
    {
      key: "baseUrl",
      type: "string",
      label: "Academy URL",
      required: true,
      helpText: "Credential-free HTTPS origin without a trailing path.",
    },
    {
      key: "apiKey",
      type: "password",
      label: "API key",
      required: true,
      helpText: "Use a dedicated key with automations:write and bundles:read scopes.",
    },
  ],
  test,
  connectionLabel: "{{server}}",
} satisfies Authentication;

export default authentication;

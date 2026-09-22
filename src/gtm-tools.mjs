import * as z from 'zod/v4';
import { GtmApiError } from './gtm-client.mjs';

const ids = {
  account_id: z.string().trim().min(1).optional(),
  container_id: z.string().trim().min(1),
  workspace_id: z.string().trim().min(1),
};

const pageToken = z.string().trim().min(1).optional();

function errorResult(summary, error, audit) {
  const details = error instanceof GtmApiError ? error.message : 'Unexpected GTM provider error.';
  const status = error instanceof GtmApiError && error.status ? ` HTTP ${error.status}.` : '';
  if (audit) {
    audit.code = error instanceof GtmApiError
      ? String(error.code || error.status || 'gtm_error')
      : 'gtm_internal';
  }
  return {
    isError: true,
    content: [{type: 'text', text: `${summary}${status} ${details}`}],
  };
}

function registerRead(server, name, title, description, inputSchema, action, audit) {
  server.registerTool(name, {
    title,
    description,
    inputSchema,
    annotations: {readOnlyHint: true, destructiveHint: false, openWorldHint: true},
  }, async (input) => {
    try {
      const result = await action(input);
      return {structuredContent: result, content: [{type: 'text', text: JSON.stringify(result)}]};
    }
    catch (error) {
      return errorResult(`Could not read Google Tag Manager via ${name}.`, error, audit);
    }
  });
}

export function registerGtmTools(server, client, audit = null) {
  registerRead(server, 'gtm_list_accounts', 'List allowed GTM accounts', 'Read-only details of the GTM account allowed by this MCP.', {}, () => client.listAccounts(), audit);
  registerRead(server, 'gtm_list_containers', 'List GTM containers', 'Read-only list of containers in the allowed GTM account. If nextPageToken is returned, call this tool again with page_token.', {account_id: ids.account_id, page_token: pageToken}, ({account_id: accountId, page_token: token}) => client.listContainers(accountId, token), audit);
  registerRead(server, 'gtm_list_workspaces', 'List GTM workspaces', 'Read-only list of workspaces in a GTM container. If nextPageToken is returned, call this tool again with page_token.', {account_id: ids.account_id, container_id: ids.container_id, page_token: pageToken}, ({account_id: accountId, container_id: containerId, page_token: token}) => client.listWorkspaces(accountId, containerId, token), audit);
  registerRead(server, 'gtm_get_workspace', 'Get GTM workspace', 'Read-only details of one GTM workspace.', ids, ({account_id: a, container_id: c, workspace_id: w}) => client.getWorkspace(a, c, w), audit);
  registerRead(server, 'gtm_get_workspace_status', 'Get GTM workspace status', 'Read-only status, conflicts and modified entities for a GTM workspace.', ids, ({account_id: a, container_id: c, workspace_id: w}) => client.getWorkspaceStatus(a, c, w), audit);

  for (const resource of ['tags', 'triggers', 'variables']) {
    const singular = resource.slice(0, -1);
    registerRead(server, `gtm_list_${resource}`, `List GTM ${resource}`, `Read-only list of ${resource} in a GTM workspace. If nextPageToken is returned, call this tool again with page_token.`, {...ids, page_token: pageToken}, ({account_id: a, container_id: c, workspace_id: w, page_token: token}) => client.listResource(resource, a, c, w, token), audit);
    registerRead(server, `gtm_get_${singular}`, `Get GTM ${singular}`, `Read-only details of one GTM ${singular}.`, {...ids, [`${singular}_id`]: z.string().trim().min(1)}, (input) => client.getResource(resource, input.account_id, input.container_id, input.workspace_id, input[`${singular}_id`]), audit);
  }

  registerRead(server, 'gtm_list_built_in_variables', 'List GTM built-in variables', 'Read-only list of enabled built-in variables in a GTM workspace. If nextPageToken is returned, call this tool again with page_token.', {...ids, page_token: pageToken}, ({account_id: a, container_id: c, workspace_id: w, page_token: token}) => client.listBuiltInVariables(a, c, w, token), audit);
  registerRead(server, 'gtm_list_versions', 'List GTM container version headers', 'Read-only list of container version headers. If nextPageToken is returned, call this tool again with page_token.', {account_id: ids.account_id, container_id: ids.container_id, page_token: pageToken}, ({account_id: a, container_id: c, page_token: token}) => client.listVersions(a, c, token), audit);
  registerRead(server, 'gtm_get_live_version', 'Get GTM live version', 'Read-only details of the currently published GTM container version.', {account_id: ids.account_id, container_id: ids.container_id}, ({account_id: a, container_id: c}) => client.getLiveVersion(a, c), audit);
}

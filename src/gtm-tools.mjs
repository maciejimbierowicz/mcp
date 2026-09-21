import * as z from 'zod/v4';
import { GtmApiError } from './gtm-client.mjs';

const ids = {
  account_id: z.string().trim().min(1).optional(),
  container_id: z.string().trim().min(1),
  workspace_id: z.string().trim().min(1),
};


function errorResult(summary, error) {
  const details = error instanceof GtmApiError ? error.message : 'Unexpected GTM provider error.';
  const status = error instanceof GtmApiError && error.status ? ` HTTP ${error.status}.` : '';
  return {
    isError: true,
    content: [{type: 'text', text: `${summary}${status} ${details}`}],
  };
}

function registerRead(server, name, title, description, inputSchema, action) {
  server.registerTool(name, {
    title,
    description,
    inputSchema,
    annotations: {readOnlyHint: true, destructiveHint: false, openWorldHint: false},
  }, async (input) => {
    try {
      const result = await action(input);
      return {structuredContent: result, content: [{type: 'text', text: JSON.stringify(result)}]};
    }
    catch (error) {
      return errorResult(`Could not read Google Tag Manager via ${name}.`, error);
    }
  });
}

export function registerGtmTools(server, client) {
  registerRead(server, 'gtm_list_accounts', 'List GTM accounts', 'Read-only list of Google Tag Manager accounts available to the authorized Google user.', {}, () => client.listAccounts());
  registerRead(server, 'gtm_list_containers', 'List GTM containers', 'Read-only list of containers in a GTM account.', {account_id: ids.account_id}, ({account_id: accountId}) => client.listContainers(accountId));
  registerRead(server, 'gtm_list_workspaces', 'List GTM workspaces', 'Read-only list of workspaces in a GTM container.', {account_id: ids.account_id, container_id: ids.container_id}, ({account_id: accountId, container_id: containerId}) => client.listWorkspaces(accountId, containerId));
  registerRead(server, 'gtm_get_workspace', 'Get GTM workspace', 'Read-only details of one GTM workspace.', ids, ({account_id: a, container_id: c, workspace_id: w}) => client.getWorkspace(a, c, w));
  registerRead(server, 'gtm_get_workspace_status', 'Get GTM workspace status', 'Read-only status, conflicts and modified entities for a GTM workspace.', ids, ({account_id: a, container_id: c, workspace_id: w}) => client.getWorkspaceStatus(a, c, w));

  for (const resource of ['tags', 'triggers', 'variables']) {
    const singular = resource.slice(0, -1);
    registerRead(server, `gtm_list_${resource}`, `List GTM ${resource}`, `Read-only list of ${resource} in a GTM workspace.`, ids, ({account_id: a, container_id: c, workspace_id: w}) => client.listResource(resource, a, c, w));
    registerRead(server, `gtm_get_${singular}`, `Get GTM ${singular}`, `Read-only details of one GTM ${singular}.`, {...ids, [`${singular}_id`]: z.string().trim().min(1)}, (input) => client.getResource(resource, input.account_id, input.container_id, input.workspace_id, input[`${singular}_id`]));
  }

  registerRead(server, 'gtm_list_built_in_variables', 'List GTM built-in variables', 'Read-only list of enabled built-in variables in a GTM workspace.', ids, ({account_id: a, container_id: c, workspace_id: w}) => client.listBuiltInVariables(a, c, w));
  registerRead(server, 'gtm_list_versions', 'List GTM container versions', 'Read-only list of container versions.', {account_id: ids.account_id, container_id: ids.container_id}, ({account_id: a, container_id: c}) => client.listVersions(a, c));
  registerRead(server, 'gtm_get_live_version', 'Get GTM live version', 'Read-only details of the currently published GTM container version.', {account_id: ids.account_id, container_id: ids.container_id}, ({account_id: a, container_id: c}) => client.getLiveVersion(a, c));
}

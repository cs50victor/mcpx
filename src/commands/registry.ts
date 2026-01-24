import {
  ErrorCode,
  formatCliError,
  registryFetchError,
  registryServerNotFoundError,
} from '../errors.js';
import {
  formatJson,
  formatRegistryList,
  formatRegistryServer,
} from '../output.js';
import {
  type Registry,
  fetchRegistry,
  findServer,
  getRegistryUrl,
} from '../registry.js';

export interface RegistryOptions {
  action: 'list' | 'get';
  serverName?: string;
  json: boolean;
}

export async function registryCommand(options: RegistryOptions): Promise<void> {
  let registry: Registry;
  try {
    registry = await fetchRegistry();
  } catch (error) {
    const url = getRegistryUrl();
    console.error(
      formatCliError(registryFetchError(url, (error as Error).message)),
    );
    process.exit(ErrorCode.NETWORK_ERROR);
  }

  if (options.action === 'list') {
    if (options.json) {
      console.log(formatJson(registry.servers));
    } else {
      console.log(formatRegistryList(registry.servers));
    }
    return;
  }

  if (options.action === 'get') {
    if (!options.serverName) {
      console.error('Usage: mcpx registry get <server-name>');
      process.exit(ErrorCode.CLIENT_ERROR);
    }

    const server = findServer(registry, options.serverName);
    if (!server) {
      console.error(
        formatCliError(
          registryServerNotFoundError(
            options.serverName,
            registry.servers.map((s) => s.name),
          ),
        ),
      );
      process.exit(ErrorCode.CLIENT_ERROR);
    }

    if (options.json) {
      console.log(formatJson(server));
    } else {
      console.log(formatRegistryServer(server));
    }
  }
}

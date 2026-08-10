import { ADDON_CAPABILITIES, type AddonCapability, type AddonManifest } from './types.js';

const MANIFEST_KEYS = new Set(['schema', 'id', 'name', 'version', 'description', 'entrypoint', 'permissions']);
const ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,62})(?:\.[a-z0-9](?:[a-z0-9-]{0,62}))*$/;
const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;
const ENTRYPOINT_PATTERN = /^(?![a-zA-Z][a-zA-Z0-9+.-]*:)(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9_./-]+$/;

export class AddonManifestError extends Error {
  readonly code = 'ADDON_MANIFEST_INVALID';
}

export function parseAddonManifest(value: unknown): AddonManifest {
  if (!isRecord(value)) throw new AddonManifestError('Addon manifest must be an object');
  const unknownKey = Object.keys(value).find(key => !MANIFEST_KEYS.has(key));
  if (unknownKey) throw new AddonManifestError(`Unknown addon manifest field: ${unknownKey}`);
  if (value.schema !== 'keystone.addon.v1') throw new AddonManifestError('Unsupported addon manifest schema');
  const id = boundedString(value.id, 'id', 253);
  if (!ID_PATTERN.test(id)) throw new AddonManifestError('Addon id must be a lower-case reverse-domain identifier');
  const name = boundedString(value.name, 'name', 80);
  const version = boundedString(value.version, 'version', 80);
  if (!VERSION_PATTERN.test(version)) throw new AddonManifestError('Addon version must be semantic versioning');
  const entrypoint = boundedString(value.entrypoint, 'entrypoint', 240);
  if (!ENTRYPOINT_PATTERN.test(entrypoint)) throw new AddonManifestError('Addon entrypoint must be a safe relative bundle path');
  if (!Array.isArray(value.permissions) || value.permissions.length > 16) throw new AddonManifestError('Addon permissions must be an array with at most 16 entries');
  if (!value.permissions.every(permission => typeof permission === 'string' && (ADDON_CAPABILITIES as readonly string[]).includes(permission))) throw new AddonManifestError('Addon requested an unknown capability');
  if (new Set(value.permissions).size !== value.permissions.length) throw new AddonManifestError('Addon permissions must be unique');
  const description = value.description === undefined ? undefined : boundedString(value.description, 'description', 500);
  return {
    schema: 'keystone.addon.v1', id, name, version, entrypoint,
    permissions: [...value.permissions] as AddonCapability[],
    ...(description ? { description } : {}),
  };
}

function boundedString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) throw new AddonManifestError(`Addon ${field} is invalid`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

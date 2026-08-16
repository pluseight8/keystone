import { describe, expect, it } from 'vitest';
import { SodiumCryptoProvider } from '../crypto.js';
import { IdentityManager } from '../identity.js';
import { contentUri, createContentManifest } from './content.js';
import { InMemoryMusicStorage, MusicService, PlaybackController, type AudioPlaybackAdapter } from './music.js';

async function fixture(name = 'artist') { const keys = await (await IdentityManager.generate()).sessionKeys(name); return { keys, storage: new InMemoryMusicStorage(), service: new MusicService(new InMemoryMusicStorage(), new SodiumCryptoProvider(), keys) }; }

describe('MusicService', () => {
  it('creates a single signed Track referencing generic content and declared rights', async () => {
    const keys = await (await IdentityManager.generate()).sessionKeys('artist'), storage = new InMemoryMusicStorage(), music = new MusicService(storage, new SodiumCryptoProvider(), keys); const audio = await createContentManifest(Uint8Array.from({ length: 20_000 }, (_, index) => index), { mimeType: 'audio/ogg', chunkSize: 16 * 1024 }); const artist = await music.createArtist({ name: 'Keystone Artist' }); const track = await music.createTrack({ title: 'One object', artistIds: [artist.payload.artistId], audioUri: contentUri(audio.contentId), durationMs: 120_000, codec: 'opus', explicit: false, rights: { declaredRightsHolder: { name: 'A separate rights holder' }, license: 'CC-BY' } }); const playlist = await music.createPlaylist({ title: 'Saved', trackIds: [track.payload.trackId], collaborative: false });
    expect(track.author).toBe(keys.nodeId); expect(track.payload.audioUri).toBe(contentUri(audio.contentId)); expect(track.payload.rights.declaredRightsHolder?.name).toBe('A separate rights holder'); expect(playlist.references[0]?.id).toBe(track.payload.trackId);
  });
  it('accepts only valid signed remote music objects', async () => {
    const keys = await (await IdentityManager.generate()).sessionKeys('artist'), sourceStorage = new InMemoryMusicStorage(), source = new MusicService(sourceStorage, new SodiumCryptoProvider(), keys), remote = new MusicService(new InMemoryMusicStorage(), new SodiumCryptoProvider(), await (await IdentityManager.generate()).sessionKeys('remote')); const artist = await source.createArtist({ name: 'A' }); expect(await remote.ingest(artist)).toBeDefined(); expect(await remote.ingest({ ...artist, signature: 'bad' })).toBeUndefined();
  });
  it('drives a local playback adapter without creating a streaming backend', async () => {
    const calls: string[] = []; const adapter: AudioPlaybackAdapter = { async play(track, position) { calls.push(`play:${track.id}:${position}`); }, async pause() { calls.push('pause'); }, async seek(position) { calls.push(`seek:${position}`); } }; const keys = await (await IdentityManager.generate()).sessionKeys('artist'), music = new MusicService(new InMemoryMusicStorage(), new SodiumCryptoProvider(), keys); const artist = await music.createArtist({ name: 'A' }); const manifest = await createContentManifest(Uint8Array.from({ length: 20_000 }, (_, index) => index), { mimeType: 'audio/ogg', chunkSize: 16 * 1024 }); const track = await music.createTrack({ title: 'T', artistIds: [artist.payload.artistId], audioUri: contentUri(manifest.contentId), durationMs: 10_000, codec: 'opus', explicit: false, rights: {} }); const playback = new PlaybackController(adapter); playback.setQueue([track]); await playback.play(); await playback.seek(500); await playback.pause(); expect(calls).toEqual([`play:${track.id}:0`, 'seek:500', 'pause']);
  });
});

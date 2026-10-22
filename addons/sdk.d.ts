/** Noctune extensions SDK 1. */
type SettingField = { label: string; description?: string; visibleWhen?: { field: string; equals: string | number | boolean } } & (
    { type: 'toggle'; default: boolean } |
    { type: 'text'; default: string; maxLength?: number } |
    { type: 'slider' | 'number'; default: number; min: number; max: number; step: number } |
    { type: 'select'; default: string; options: { value: string; label: string }[]; source?: 'appearance.schemes' | 'backgrounds' }
);
interface OAuthProvider {
    name: string; flow: 'authorization_code' | 'device_code'; clientId: string;
    authorizationUrl?: string; deviceAuthorizationUrl?: string; tokenUrl: string;
    scopes: string[]; resourceOrigins: string[]; redirectPort?: number; extraParams?: Record<string, string>;
}
interface NoctuneAddonManifest {
    id: string; name: string; description: string; author: string; version: string; revision: number;
    apiVersion: 1; minNoctuneVersion: string; maxNoctuneVersion?: string;
    type: 'extension' | 'integration'; entry: string; permissions: string[];
    /** Noctune >=1.4.0: network origins/routes also accept https://*.example.com (subdomains only).
     * OAuth resourceOrigins and credential origins must still be exact HTTPS origins explicitly listed here. */
    network?: { origins: string[]; routes?: { origin: string; path: string; prefix?: boolean; methods: ('GET'|'HEAD'|'POST'|'PUT'|'PATCH'|'DELETE')[]; permission?: `servicePlaylists.${ServicePlaylistAction}` }[] };
    credentials?: Record<string, {name:string;description?:string;origins:string[];header:string;scheme:string}>;
    ui?: {integrations:{title:string;description?:string;sections:{id:string;title:string;fields:string[]}[]}}; settings?: Record<string, SettingField>; oauth?: Record<string, OAuthProvider>;
    icon?: string; banner?: string;
    commands: { id: string; title: string }[]; update?: { url: string; channel: 'stable' }; homepage?: string;
}
interface TrackState {
    trackId: string | null; sessionId: string | null; title: string; artist: string; radio: boolean;
    shuffle?: boolean; repeat?: 0 | 1 | 2;
    source?: 'file' | 'radio' | 'provider'; playing: boolean; position: number; duration: number; volume: number; speed: number;
}
interface AddonEvent extends Partial<TrackState> {
    type: string; sequence: number; timestamp: number; reason?: string; profile?:string; configured?:boolean; addonId?: string; values?: Record<string, unknown>;
    error?: { code: string | number; message: string }; [key: string]: unknown;
}
type TrackContext = { sessionId?: string };
interface ServiceMedia { album?:string; duration?:number; artwork?:string; canonicalId?:string }
interface ProviderTrack extends ServiceMedia { id: string; title: string; artist?: string }
interface StreamDescriptor { url: string; transport?: 'direct'; oauth?: string; credential?: string; headers?: Record<string, string> }
interface ProviderFailure { error: { code: 'AUTH_REQUIRED' | 'REGION_RESTRICTED' | 'SUBSCRIPTION_REQUIRED' | 'NOT_FOUND' | 'RATE_LIMITED' | 'NETWORK' | 'UNSUPPORTED_TRANSPORT'; message: string } }
interface SelectedFile { handle: string; name: string; size: number }
type AppearanceMode = 'light'|'dark'|'system';
type AppearancePalette = Partial<Record<'background'|'surface'|'text'|'muted'|'border'|'hover'|'accent'|'secondary',string>>;
interface LocalPlaylist { id:string;name:string;type:string;revision:number;tracks:{trackId:string;title:string;entryId?:string}[] }
type ServicePlaylistAction = 'read'|'create'|'rename'|'delete'|'addTracks'|'removeTracks'|'reorder';
interface CatalogEntry extends ServiceMedia {id:string;type:'track'|'album'|'artist'|'playlist';title:string;artist?:string;addonId?:string;providerId?:string;accountId?:string}
interface CatalogPage {items:CatalogEntry[];cursor?:string|null}
interface ServiceRead {id?:string;cursor?:string|null;after?:string;reason?:'open'|'continue'}
interface ServicePlaylist {id:string;name:string;revision:string;artwork?:string;total?:number;continuous?:boolean;tracks?:(ProviderTrack&{entryId:string})[];cursor?:string|null;addonId?:string;providerId?:string;accountId?:string}
interface ServiceMutation {catalog:string;requestId:string}
interface ServiceReceipt {id:string;revision:string;deleted?:boolean}
interface CatalogProvider {
    id:string;name:string;providerId:string;accountId:string;
    browse?(args:{parent?:{id:string;type:string}|null;cursor?:string|null}):Promise<CatalogPage>|CatalogPage;
    search?(args:{query:string;cursor?:string|null}):Promise<CatalogPage>|CatalogPage;
    read?(args:ServiceRead):Promise<ServicePlaylist|{items:ServicePlaylist[];cursor?:string|null}>|ServicePlaylist|{items:ServicePlaylist[];cursor?:string|null};
    create?(args:ServiceMutation&{name:string}):Promise<ServiceReceipt>|ServiceReceipt;
    rename?(args:ServiceMutation&{id:string;revision:string;name:string}):Promise<ServiceReceipt>|ServiceReceipt;
    delete?(args:ServiceMutation&{id:string;revision:string}):Promise<ServiceReceipt>|ServiceReceipt;
    addTracks?(args:ServiceMutation&{id:string;revision:string;tracks:string[]}):Promise<ServiceReceipt>|ServiceReceipt;
    removeTracks?(args:ServiceMutation&{id:string;revision:string;entries:string[]}):Promise<ServiceReceipt>|ServiceReceipt;
    reorder?(args:ServiceMutation&{id:string;revision:string;entries:string[]}):Promise<ServiceReceipt>|ServiceReceipt;
}
interface AddonLyrics {status:'found'|'missing'|'instrumental'|'error';lines:{time:number;text:string}[];plain:string;source?:string}
interface NoctuneAddonApi {
    readonly version: 1; readonly manifest: Readonly<NoctuneAddonManifest>;
    onCommand(id: string, handler: () => void | Promise<void>): void;
    on(type: string, handler: (event: AddonEvent) => void | Promise<void>): () => void;
    readText(file: string): string;
    assets: { read(file: string): { mime: string; base64: string; size: number }; url(file: string): string };
    storage: { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void> };
    settings: { get(): Promise<Record<string, unknown>> };
    notify(message: string): Promise<void>;
    player: {
        current(): Promise<TrackState>; play(options?: TrackContext & { trackId?: string }): Promise<void>;
        pause(context?: TrackContext): Promise<void>; stop(context?: TrackContext): Promise<void>;
        next(context?: TrackContext): Promise<void>; previous(context?: TrackContext): Promise<void>;
        seek(position: number, context?: TrackContext): Promise<void>;
        shuffle(value: boolean): Promise<void>; repeat(value: 0 | 1 | 2): Promise<void>;
        volume(value: number, context?: TrackContext): Promise<void>; speed(value: number, context?: TrackContext): Promise<void>;
    };
    queue: { read(): Promise<{ id: string; trackId: string; playlistId: string | null; index: number }[]>; add(args: { trackId: string }): Promise<string>; remove(args: { id: string }): Promise<void>; reorder(args: { id: string; index: number }): Promise<void> };
    playlists: {
        read(): Promise<LocalPlaylist[]>;
        create(args: {name:string}): Promise<string>;
        rename(args: {id:string;revision:number;name:string}): Promise<void>;
        delete(args: {id:string;revision:number}): Promise<void>;
        edit(args: {id:string;revision:number;tracks:string[]}): Promise<void>;
        select(args:{id:string}):Promise<void>;
        addTracks(args:{id:string;revision:number;tracks:string[];index?:number}):Promise<LocalPlaylist>;
        removeTracks(args:{id:string;revision:number;entries:string[]}):Promise<LocalPlaylist>;
        reorder(args:{id:string;revision:number;entries:string[]}):Promise<LocalPlaylist>;
    };
    appearance: {
        list():Promise<{id:string;name:string;mode:AppearanceMode;owner:string|null;schemeId?:string;provider?:string}[]>;
        select(args:TrackContext&{id:string|null}):Promise<void>;
        read():Promise<{mode:AppearanceMode;effectiveMode:'light'|'dark';palette:AppearancePalette;effectivePalette:Record<keyof AppearancePalette,string>}>;
        mode(args:TrackContext&{mode:AppearanceMode|null}):Promise<void>;
        palette(args:TrackContext&{palette:AppearancePalette|null}):Promise<void>;
        register(args:{id:string;name:string;mode:AppearanceMode;palette:AppearancePalette}):Promise<void>;
        switch(args:TrackContext&{id:string|null}):Promise<void>;
        persist():Promise<void>;
    };
    credentials: {
        configure(profile:string):Promise<{configured:boolean}>;
        status(profile:string):Promise<{configured:boolean;secureStorage:boolean;expiresAt?:number|null}>;
        disconnect(profile:string):Promise<void>;
    };
    catalog: {register(catalog:CatalogProvider):Promise<void>;unregister(id:string):Promise<void>;search(args:{catalog:string;query:string;cursor?:string|null}):Promise<CatalogPage>;browse(args:{catalog:string;parent?:{id:string;type:'album'|'artist'|'playlist'}|null;cursor?:string|null}):Promise<CatalogPage>};
    servicePlaylists: {
        read(args:ServiceRead&{catalog:string}):Promise<ServicePlaylist|{items:ServicePlaylist[];cursor?:string|null}>;
        create(args:ServiceMutation&{name:string}):Promise<ServiceReceipt>;
        rename(args:ServiceMutation&{id:string;revision:string;name:string}):Promise<ServiceReceipt>;
        delete(args:ServiceMutation&{id:string;revision:string}):Promise<ServiceReceipt>;
        addTracks(args:ServiceMutation&{id:string;revision:string;tracks:string[]}):Promise<ServiceReceipt>;
        removeTracks(args:ServiceMutation&{id:string;revision:string;entries:string[]}):Promise<ServiceReceipt>;
        reorder(args:ServiceMutation&{id:string;revision:string;entries:string[]}):Promise<ServiceReceipt>;
    };
    artwork:{read(context?:TrackContext):Promise<{sessionId:string|null;dataUrl:string;width:number;height:number}|null>};
    lyrics:{read(context?:TrackContext):Promise<AddonLyrics>;provide(source:{id:string;resolve(track:{title:string;artist:string;album:string;duration:number;sessionId:string|null}):Promise<AddonLyrics>|AddonLyrics}):Promise<void>};
    hotkeys:{register(args:{command:string}):Promise<void>};
    themes: { /** Temporary accent overlay, automatically released on disable/error. null releases this owner's overlay. */ accent(args: { color: string | null }): Promise<void>; list(): Promise<{ id: string; name: string; parameters: Record<string, unknown> }[]>; switch(args: TrackContext & { id: string | null }): Promise<void>; apply(args: TrackContext & { parameters?: Record<string, unknown>; palette?: { accent: string; gradient: [string, string, string] } }): Promise<void> };
    backgrounds: { list(): Promise<{ id: string; name: string; video: boolean }[]>; switch(args: TrackContext & { id: string }): Promise<void>; override(args:TrackContext&{id:string|null}):Promise<void>; apply(args: TrackContext & { enabled?: boolean; fit?: 'cover' | 'contain' | 'fill'; blur?: number; threshold?: number }): Promise<void> };
    audio: {
        gain(args:{gain:number|null;ramp?:number}):Promise<void>;
        analyse(): Promise<{ sampleRate: number; samples: number[]; sessionId?: string }>;
        pcm(): Promise<{ sampleRate: number; samples: number[]; sessionId?: string }>;
        equalizer(args: { preset?: string; bands?: number[] }): Promise<void>;
        effects(args: { chain: ({ type: 'gain'; gain: number } | { type: 'biquad'; filter: BiquadFilterType; frequency: number; q?: number; gain?: number } | { type: 'compressor'; threshold?: number; ratio?: number })[] }): Promise<void>;
    };
    network: { text(url: string): Promise<string>; json(url: string): Promise<unknown>; request(args: { url: string; method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD'; body?: string; headers?: Record<string, string>; oauth?: string; credential?:string }): Promise<{ status: number; headers: Record<string, string>; body: string }> };
    oauth: { authorize(provider: string): Promise<{ connected: boolean }>; status(provider: string): Promise<{ connected: boolean; secureStorage: boolean; expiresAt?: number | null }>; disconnect(provider: string): Promise<void> };
    secrets: { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void>; delete(key: string): Promise<void> };
    files: { select(): Promise<SelectedFile | null>; save(): Promise<SelectedFile | null>; library(args: { trackId: string }): Promise<SelectedFile>; read(args: { handle: string; encoding?: 'utf8' | 'base64' }): Promise<{ encoding: string; data: string }>; write(args: { handle: string; data: string; encoding?: 'utf8' | 'base64' }): Promise<void>; reveal(args: { handle: string }): Promise<void> };
    clipboard: { read(): Promise<string>; write(text: string): Promise<void> };
    system: { openExternal(url: string): Promise<void>; openFile(handle: string): Promise<void> };
    providers: {
        register(provider: { id: string; name: string; search?(args: { query: string }): Promise<ProviderTrack[]> | ProviderTrack[]; resolve(args: { trackId: string; reason: 'play' | 'refresh'; sessionId: string }): Promise<StreamDescriptor | ProviderFailure> | StreamDescriptor | ProviderFailure }): Promise<void>;
        search(provider: string, query: string): Promise<ProviderTrack[]>; play(provider: string, track: ProviderTrack): Promise<void>; enqueue(provider: string, track: ProviderTrack): Promise<string>;
    };
}
declare const NoctuneAddon: { define(activate: (api: NoctuneAddonApi) => void | Promise<void>): void };

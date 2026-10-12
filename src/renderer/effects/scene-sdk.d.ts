/** Global SDK available only in a Noctune scene sandbox. No player DOM or network. */
declare namespace NoctuneScene {
    type Point = [number, number];
    type Rect = { x: number; y: number; width: number; height: number };
    type Spacing = 'linear' | 'log' | 'hybrid';
    type Label = string | Record<string, string>;
    type ParameterValue = number | boolean | string;
    type Parameters = Record<string, ParameterValue>;
    type Parameter =
        | { type: 'slider'; label: Label; default: number; min: number; max: number; step: number }
        | { type: 'toggle'; label: Label; default: boolean }
        | { type: 'select'; label: Label; default: string; options: { value: string; label: Label }[] };
    interface Palette { accent: string; background: string; gradient: [string, string, string] }
    interface Manifest {
        apiVersion?: 1 | 2;
        id: string; name: string; description: string; author: string; version: string;
        width: number; height: number; preview: string; palette: Palette;
        capabilities: { visualizer: 'bars' | 'line' | 'radial' | 'character' | 'none'; motion: boolean; visualizers?: ('bars' | 'line' | 'radial' | 'character' | 'none')[] };
        parameters?: { frequencyMix?: number; glowIntensity?: number };
        runtimeRequirements?: { dom: boolean };
        parameterSchema?: Record<string, Parameter>;
        quality?: 'low' | 'balanced' | 'high';
    }
    interface Audio {
        /** FFT bins 0..255, original analyser length, not resampled. */
        spectrum: Uint8Array | number[];
        sampleRate: number; playing: boolean; enabled: boolean; intensity: number;
        frequencyMix?: number;
    }
    interface Frame {
        /** CSS pixels, not logical scene pixels. */
        width: number; height: number; dpr: number;
        /** Seconds. dt is capped at .08. time advances only with host motion enabled. */
        time: number; dt: number; motion: boolean;
        reducedMotion: boolean;
        lighting: { intensity: number };
        parameters: Parameters;
        /** Player controls bounds in viewport CSS pixels, or null. */
        safeArea: Rect | null;
        audio: Audio;
    }
    type Surface = HTMLCanvasElement | OffscreenCanvas;
    type Context = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
    type Image = CanvasImageSource;
    interface BandsOptions {
        count?: number; minHz?: number; maxHz?: number; spacing?: Spacing;
        /** Exponential response rates per second, not durations. */
        attack?: number; release?: number; smoothing?: number;
    }
    type Source = Float32Array | number[] | (() => Float32Array | number[]);
    interface SpectrumOptions extends BandsOptions {
        x: number; y: number; width: number; height: number; opacity?: number; source?: Source;
    }
    interface LineOptions extends SpectrumOptions {
        reflection?: boolean; fill?: number; adaptiveFill?: boolean; hideWhenSilent?: boolean;
    }
    interface CharacterOptions {
        anchor?: number; hairY?: Point; contour?: boolean; blink?: string;
        eyes?: [number, number, number, number][]; eyeGlow?: [number, number, number][];
        breathAmplitude?: number; hairStrength?: number; blinkInterval?: number; contourColor?: string;
        stop?: 'freeze' | 'hide';
    }
    interface StarsOptions {
        minInterval?: number; maxInterval?: number; color?: string; opacity?: number; glow?: number; stop?: 'freeze' | 'hide';
    }
    interface API {
        readonly apiVersion: 2; readonly runtime: 'worker' | 'iframe';
        canvas: Surface; ctx: Context; manifest: Manifest; images: Record<string, Image>;
        width: number; height: number; palette: Palette;
        time: number; dt: number; motion: boolean; audio: Audio; parameters: Parameters;
        /** Energy 0..1, pulse 0..2.6; normalizedPulse 0..1. */
        energy: number; pulse: number; normalizedPulse: number; glowIntensity: number;
        readonly quality: { dpr: number; particles: number; surfaces: number; pixels: number; caches: number };
        readonly visibleRect: Rect; readonly safeArea: Rect | null;
        createSurface(width?: number, height?: number): Surface;
        releaseSurface(surface: Surface): void;
        replaceImage(id: string, image: Image): void;
        setPalette(palette: Palette): void;
        invalidate(): void; reset(): void; dispose(): void;
        on(event: 'resize', callback: (viewport: { width: number; height: number; dpr: number }) => void): () => void;
        on(event: 'parameters', callback: (parameters: Parameters) => void): () => void;
        on(event: 'audio', callback: (audio: { playing: boolean; enabled: boolean; sampleRate: number; bins: number }) => void): () => void;
        on(event: 'resources', callback: (change: { image?: string; palette?: Palette }) => void): () => void;
        on(event: 'reset' | 'dispose', callback: () => void): () => void;
        sceneToScreen(x: number, y: number): { x: number; y: number };
        screenToScene(x: number, y: number): { x: number; y: number };
        anchor(horizontal?: number, vertical?: number, inset?: number): { x: number; y: number };
        compose(groups: Partial<Record<'background' | 'effects' | 'foreground', (api: API) => void>>): void;
        clipMask(asset: string, draw: (api: API) => void, options?: { invert?: boolean; feather?: number }): void;
        clip(polygons: Point[][], draw: () => void): void;
        plane(options: { origin?: Point; xAxis?: Point; yAxis?: Point; relative?: boolean; width?: number; height?: number }, draw: () => void): void;
        layer(id: string, opacity?: number): void;
        gradient(x0: number, y0: number, x1: number, y1: number): CanvasGradient;
        spectrum(count?: number, minHz?: number, maxHz?: number, key?: string, spacing?: Spacing): Float32Array;
        bandsSource(options?: BandsOptions): Float32Array;
        smoothSpectrum(values: Float32Array, amount?: number): Float32Array;
        bars(options: SpectrumOptions): void; line(options: LineOptions): void;
        radialSpectrum(options?: { x?: number; y?: number; radius?: number; height?: number; source?: Source; opacity?: number; color?: string; glow?: number; startAngle?: number; endAngle?: number }): void;
        reflection(options: { baseline: number; height: number; opacity?: number; distortion?: number; strips?: number; mask?: string; invert?: boolean }, draw: (api: API) => void): void;
        waterRipple(options: { x: number; y: number; radius?: number; strength?: number; opacity?: number; color?: string; rings?: number; speed?: number }): void;
        character(id: string, options?: CharacterOptions): void;
        light(x: number, y: number, radius: number, opacity: number, color?: string): void;
        flicker(points: [number, number, number, string?, number?][]): void;
        rain(): void; shootingStars(options?: StarsOptions): void;
    }
    interface Scene {
        init?(api: API): void | Promise<void>;
        render(api: API, frame: Frame): void;
        resize?(api: API, viewport: { width: number; height: number; dpr: number }): void;
        parameters?(api: API, values: Parameters): void;
        audio?(api: API, state: { playing: boolean; enabled: boolean; sampleRate: number; bins: number }): void;
        reset?(api: API): void; dispose?(api: API): void;
    }
    function define(scene: Scene): void;
    function create(canvas: Surface, manifest: Manifest, images: Record<string, Image>, apiVersion: 2, runtime?: 'worker' | 'iframe'): API;
    function clamp(value: number, min?: number, max?: number): number;
    function ease(old: number, next: number, dt: number, speed: number): number;
}

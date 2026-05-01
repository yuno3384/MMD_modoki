import type { EffectPlugin } from "./plugin-types";

type InternalLuminousGlowEffectDeps = {
    sync: () => void;
    dispose?: () => void;
};

/**
 * Internal adapter for the existing GlowLayer / AutoLuminous-lite behavior.
 *
 * This plugin does not reimplement glow logic. It delegates to the current
 * luminous sync path so the plugin host can own an existing effect safely.
 *
 * Current limitation:
 * - several existing direct calls to the glow sync path still remain in core
 *   material/state update flows to preserve behavior without broad refactoring
 */
export function createInternalLuminousGlowEffect(
    deps: InternalLuminousGlowEffectDeps,
): EffectPlugin {
    const sync = (): void => {
        deps.sync();
    };

    return {
        id: "internal-luminous-glow",
        kind: "hybrid",
        onSceneReady(): void {
            sync();
        },
        onModelLoaded(): void {
            sync();
        },
        onAccessoryLoaded(): void {
            sync();
        },
        onDispose(): void {
            deps.dispose?.();
        },
    };
}

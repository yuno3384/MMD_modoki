import { describe, expect, it } from "vitest";

import {
    createInternalMmeCompatManifestPlugin,
    filterAndSortMmeTargetCandidates,
    getMmeCompatApplyButtonState,
    getSelectedMmeTargetCandidateDetail,
    getSelectedMmeTargetCandidateHighlightDetail,
    getMmeCompatApplyStatus,
    getMmeCompatRevertButtonState,
    getMmeFilePathFromPickerFile,
    registerPickedMmeFiles,
    syncSelectedMmeTargetCandidateId,
} from "./internal-mme-compat-manifest-plugin";
import type { SceneHookContext } from "./plugin-types";
import type { MmeFallbackTargetCandidate } from "./mme-fallback-controller";

const TEST_SCENE_CONTEXT: SceneHookContext = {
    runtime: {
        scene: null,
        engine: null,
        camera: null,
    },
    scene: null,
    engine: null,
    camera: null,
};

describe("InternalMmeCompatManifestPlugin", () => {
    it("filters candidates by kind, preset, and status without mutating the source array", () => {
        const candidates = createCandidateFixtures();
        const originalSnapshot = [...candidates];

        const filtered = filterAndSortMmeTargetCandidates(candidates, {
            kind: "model",
            preset: "basicToon",
            status: "global-effect-candidate",
            search: "",
            sortKey: "confidenceDesc",
        });

        expect(filtered).toHaveLength(1);
        expect(filtered[0].targetId).toBe("model-body");
        expect(candidates).toEqual(originalSnapshot);
    });

    it("filters candidates by text search and sorts by confidence descending", () => {
        const candidates = createCandidateFixtures();

        const filtered = filterAndSortMmeTargetCandidates(candidates, {
            kind: "all",
            preset: "all",
            status: "all",
            search: "body",
            sortKey: "confidenceDesc",
        });

        expect(filtered.map((candidate) => candidate.targetId)).toEqual(["model-body", "accessory-body"]);
        expect(filtered[0].confidence).toBeGreaterThanOrEqual(filtered[1].confidence);
    });

    it("sorts candidates by material name", () => {
        const candidates = createCandidateFixtures();

        const filtered = filterAndSortMmeTargetCandidates(candidates, {
            kind: "all",
            preset: "all",
            status: "all",
            search: "",
            sortKey: "materialName",
        });

        expect(filtered.map((candidate) => candidate.materialName)).toEqual([
            "AccessoryBodyMaterial",
            "BodyMaterial",
            "FaceMaterial",
        ]);
    });

    it("finds a selected candidate by id without mutating candidates", () => {
        const candidates = createCandidateFixtures();
        const originalSnapshot = [...candidates];

        const detail = getSelectedMmeTargetCandidateDetail(candidates, "accessory-body");

        expect(detail.selectedCandidateId).toBe("accessory-body");
        expect(detail.selectedCandidate?.materialName).toBe("AccessoryBodyMaterial");
        expect(candidates).toEqual(originalSnapshot);
    });

    it("clears selection when the candidate is no longer visible under current filters", () => {
        const candidates = createCandidateFixtures();
        const visibleCandidates = filterAndSortMmeTargetCandidates(candidates, {
            kind: "model",
            preset: "all",
            status: "all",
            search: "",
            sortKey: "confidenceDesc",
        });

        expect(syncSelectedMmeTargetCandidateId("accessory-body", visibleCandidates)).toBeNull();
        expect(syncSelectedMmeTargetCandidateId("model-body", visibleCandidates)).toBe("model-body");
    });

    it("treats a single-global-effect candidate as highlightable when target identity is clear", () => {
        const candidates = createCandidateFixtures();
        const originalSnapshot = [...candidates];

        const detail = getSelectedMmeTargetCandidateHighlightDetail(candidates, "model-body");

        expect(detail.selectedCandidateId).toBe("model-body");
        expect(detail.highlightPlan.highlightable).toBe(true);
        expect(detail.highlightPlan.reason).toBe("target-identity-clear");
        expect(detail.highlightPlan.meshName).toBe("BodyMesh");
        expect(candidates).toEqual(originalSnapshot);
    });

    it("returns a conservative non-highlightable plan for multi-global and unmatched candidates", () => {
        const candidates = createCandidateFixtures();

        const multiGlobalDetail = getSelectedMmeTargetCandidateHighlightDetail(candidates, "accessory-body");
        const unmatchedDetail = getSelectedMmeTargetCandidateHighlightDetail(candidates, "model-face");

        expect(multiGlobalDetail.highlightPlan.highlightable).toBe(false);
        expect(multiGlobalDetail.highlightPlan.reason).toBe("effect-binding-not-precise");
        expect(unmatchedDetail.highlightPlan.highlightable).toBe(false);
        expect(unmatchedDetail.highlightPlan.reason).toBe("candidate-unmatched");
    });

    it("returns a safe empty highlight plan when the selected candidate is missing", () => {
        const candidates = createCandidateFixtures();

        const detail = getSelectedMmeTargetCandidateHighlightDetail(candidates, "missing-target");

        expect(detail.selectedCandidate).toBeNull();
        expect(detail.highlightPlan.highlightable).toBe(false);
        expect(detail.highlightPlan.reason).toBe("candidate-missing");
        expect(detail.highlightPlan.targetId).toBeNull();
    });

    it("formats apply status with the experimental gate priority", () => {
        expect(getMmeCompatApplyStatus({
            enabled: false,
            mode: "preview",
            experimentalApplyEnabled: false,
        })).toBe("disabled");

        expect(getMmeCompatApplyStatus({
            enabled: true,
            mode: "preview",
            experimentalApplyEnabled: false,
        })).toBe("preview-only");

        expect(getMmeCompatApplyStatus({
            enabled: true,
            mode: "apply",
            experimentalApplyEnabled: false,
        })).toBe("experimental-disabled");

        expect(getMmeCompatApplyStatus({
            enabled: true,
            mode: "apply",
            experimentalApplyEnabled: true,
        })).toBe("experimental-ready");
    });

    it("enables apply/revert button labels only through guarded pure helper state", () => {
        expect(getMmeCompatApplyButtonState({
            enabled: false,
            reason: "experimental-apply-disabled",
            warnings: ["Experimental fallback apply opt-in is disabled"],
        })).toEqual({
            enabled: false,
            label: "Apply Fallback (guarded)",
        });

        expect(getMmeCompatApplyButtonState({
            enabled: true,
            reason: "apply-ready",
            warnings: [],
        })).toEqual({
            enabled: true,
            label: "Apply Fallback (experimental basicToon)",
        });

        expect(getMmeCompatRevertButtonState(false)).toEqual({
            enabled: false,
            label: "Revert Fallback (waiting for applied transaction)",
        });

        expect(getMmeCompatRevertButtonState(true)).toEqual({
            enabled: true,
            label: "Revert Fallback",
        });
    });

    it("prefers webkitRelativePath for picked files when available", () => {
        expect(getMmeFilePathFromPickerFile({
            name: "main.fx",
            webkitRelativePath: "bundle/main.fx",
        })).toBe("bundle/main.fx");

        expect(getMmeFilePathFromPickerFile({
            name: "fallback.fx",
            webkitRelativePath: "",
        })).toBe("fallback.fx");
    });

    it("accepted picked files pass registration", async () => {
        const registeredPaths: string[] = [];
        const summary = await registerPickedMmeFiles({
            files: [
                {
                    name: "main.fx",
                    async text() {
                        return `float4 Diffuse : DIFFUSE = float4(1, 1, 1, 1);`;
                    },
                },
            ],
            registerMmeFile(file) {
                registeredPaths.push(file.path);
                return {
                    ok: true,
                    manifest: null,
                };
            },
        });

        expect(registeredPaths).toEqual(["main.fx"]);
        expect(summary).toEqual({
            acceptedCount: 1,
            rejectedCount: 0,
            warnings: [],
        });
    });

    it("picked unsupported files produce safe warnings", async () => {
        const summary = await registerPickedMmeFiles({
            files: [
                {
                    name: "notes.txt",
                    async text() {
                        return "unsupported";
                    },
                },
            ],
            registerMmeFile() {
                return {
                    ok: false,
                    manifest: null,
                    reason: "unsupported-extension",
                };
            },
        });

        expect(summary.acceptedCount).toBe(0);
        expect(summary.rejectedCount).toBe(1);
        expect(summary.warnings).toEqual(["Unsupported MME file skipped: notes.txt"]);
    });

    it("picked multiple files preserve relative bundle paths where available", async () => {
        const registeredPaths: string[] = [];
        await registerPickedMmeFiles({
            files: [
                {
                    name: "ray.x",
                    webkitRelativePath: "bundle/ray.x",
                    async text() {
                        return "xof 0303txt 0032";
                    },
                },
                {
                    name: "ray.fx",
                    webkitRelativePath: "bundle/ray.fx",
                    async text() {
                        return `float4 Diffuse : DIFFUSE = float4(1, 1, 1, 1);`;
                    },
                },
            ],
            registerMmeFile(file) {
                registeredPaths.push(file.path);
                return {
                    ok: true,
                    manifest: null,
                };
            },
        });

        expect(registeredPaths).toEqual(["bundle/ray.x", "bundle/ray.fx"]);
    });

    it("normalizes duplicate path spellings to one registered file", () => {
        const plugin = createInternalMmeCompatManifestPlugin();

        try {
            plugin.registerMmeFile({
                path: "C:\\Effects\\\\main.fx",
                text: `float4 Diffuse : DIFFUSE = float4(1, 1, 1, 1);`,
            });
            const result = plugin.registerMmeFile({
                path: "C:/Effects/main.fx",
                text: `float4 Diffuse : DIFFUSE = float4(0, 0, 0, 1);`,
            });

            expect(result.ok).toBe(true);
            expect(result.manifest?.rootFile).toBe("C:/Effects/main.fx");
            expect(result.manifest?.discoveredFxFiles).toEqual(["C:/Effects/main.fx"]);
            expect(Object.keys(result.manifest?.parsedEffects ?? {})).toEqual(["C:/Effects/main.fx"]);
        } finally {
            plugin.onDispose?.(TEST_SCENE_CONTEXT);
        }
    });

    it("registering an fx file builds a manifest", () => {
        const plugin = createInternalMmeCompatManifestPlugin();

        try {
            const result = plugin.registerMmeFile({
                path: "C:\\Effects\\main.fx",
                text: `float4 Diffuse : DIFFUSE = float4(1, 1, 1, 1);`,
            });

            expect(result.ok).toBe(true);
            expect(result.manifest?.rootFile).toBe("C:/Effects/main.fx");
            expect(result.manifest?.discoveredFxFiles).toEqual(["C:/Effects/main.fx"]);
            expect(plugin.getCurrentMmeManifest()?.rootFile).toBe("C:/Effects/main.fx");
        } finally {
            plugin.onDispose?.(TEST_SCENE_CONTEXT);
        }
    });

    it("uses the first registered fx file as root when no x file exists", () => {
        const plugin = createInternalMmeCompatManifestPlugin();

        try {
            plugin.registerMmeFile({
                path: "C:\\Effects\\first.fx",
                text: `float4 Diffuse : DIFFUSE = float4(1, 1, 1, 1);`,
            });
            const result = plugin.registerMmeFile({
                path: "C:\\Effects\\second.fxsub",
                text: `float4 Diffuse : DIFFUSE = float4(0, 0, 0, 1);`,
            });

            expect(result.ok).toBe(true);
            expect(result.manifest?.rootFile).toBe("C:/Effects/first.fx");
            expect(result.manifest?.rootKind).toBe("fx");
        } finally {
            plugin.onDispose?.(TEST_SCENE_CONTEXT);
        }
    });

    it("promotes an x file to root even if an fx file was registered first", () => {
        const plugin = createInternalMmeCompatManifestPlugin();

        try {
            plugin.registerMmeFile({
                path: "C:\\Effects\\standalone.fx",
                text: `float4 Diffuse : DIFFUSE = float4(1, 1, 1, 1);`,
            });
            const result = plugin.registerMmeFile({
                path: "C:\\Effects\\ray.x",
                text: "xof 0303txt 0032",
            });

            expect(result.ok).toBe(true);
            expect(result.manifest?.rootFile).toBe("C:/Effects/ray.x");
            expect(result.manifest?.rootKind).toBe("x");
        } finally {
            plugin.onDispose?.(TEST_SCENE_CONTEXT);
        }
    });

    it("registering an x file can discover a same-name fx after it is added", () => {
        const plugin = createInternalMmeCompatManifestPlugin();

        try {
            const xResult = plugin.registerMmeFile({
                path: "C:\\Effects\\ray.x",
                text: "xof 0303txt 0032",
            });
            expect(xResult.ok).toBe(true);
            expect(xResult.manifest?.rootFile).toBe("C:/Effects/ray.x");
            expect(xResult.manifest?.discoveredFxFiles).toEqual([]);

            const fxResult = plugin.registerMmeFile({
                path: "C:\\Effects\\ray.fx",
                text: `float4 Diffuse : DIFFUSE = float4(1, 1, 1, 1);`,
            });
            expect(fxResult.ok).toBe(true);
            expect(fxResult.manifest?.rootFile).toBe("C:/Effects/ray.x");
            expect(fxResult.manifest?.discoveredFxFiles).toEqual(["C:/Effects/ray.fx"]);
        } finally {
            plugin.onDispose?.(TEST_SCENE_CONTEXT);
        }
    });

    it("rejects unsupported extensions", () => {
        const plugin = createInternalMmeCompatManifestPlugin();

        try {
            const result = plugin.registerMmeFile({
                path: "C:\\Effects\\notes.txt",
                text: "unsupported",
            });

            expect(result).toMatchObject({
                ok: false,
                reason: "unsupported-extension",
            });
            expect(plugin.getCurrentMmeManifest()).toBeNull();
        } finally {
            plugin.onDispose?.(TEST_SCENE_CONTEXT);
        }
    });

    it("clear resets the current manifest", () => {
        const plugin = createInternalMmeCompatManifestPlugin();

        try {
            plugin.registerMmeFile({
                path: "C:\\Effects\\main.fx",
                text: `float4 Diffuse : DIFFUSE = float4(1, 1, 1, 1);`,
            });
            expect(plugin.getCurrentMmeManifest()).not.toBeNull();

            plugin.clearMmeManifest();
            expect(plugin.getCurrentMmeManifest()).toBeNull();

            const result = plugin.registerMmeFile({
                path: "C:\\Effects\\after-clear.fx",
                text: `float4 Diffuse : DIFFUSE = float4(1, 1, 1, 1);`,
            });
            expect(result.manifest?.rootFile).toBe("C:/Effects/after-clear.fx");
        } finally {
            plugin.onDispose?.(TEST_SCENE_CONTEXT);
        }
    });
});

function createCandidateFixtures(): MmeFallbackTargetCandidate[] {
    return [
        {
            targetId: "model-body",
            effectId: "basic.fx",
            targetKind: "model",
            ownerName: "Miku",
            meshName: "BodyMesh",
            materialName: "BodyMaterial",
            sourcePath: "model.pmx",
            recommendedFallbackPreset: "basicToon",
            confidence: 0.9,
            status: "global-effect-candidate",
            warnings: [],
            blockedReasons: [],
            matchingPolicy: "single-global-effect",
        },
        {
            targetId: "accessory-body",
            effectId: "ray.fx",
            targetKind: "accessory",
            ownerName: "Accessory",
            meshName: "BodyAccessoryMesh",
            materialName: "AccessoryBodyMaterial",
            sourcePath: "ray.x",
            recommendedFallbackPreset: "unsupported",
            confidence: 0.4,
            status: "unsupported",
            warnings: ["unsupported"],
            blockedReasons: ["custom-pixel-shader"],
            matchingPolicy: "multi-global-effect",
        },
        {
            targetId: "model-face",
            effectId: null,
            targetKind: "model",
            ownerName: "Miku",
            meshName: "FaceMesh",
            materialName: "FaceMaterial",
            sourcePath: "model.pmx",
            recommendedFallbackPreset: "none",
            confidence: 0,
            status: "unmatched",
            warnings: ["unmatched"],
            blockedReasons: ["preview-unavailable"],
            matchingPolicy: "unmatched",
        },
    ];
}

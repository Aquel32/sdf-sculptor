import { d, std } from "typegpu";

export const AABB = d.struct({
    min: d.vec3f,
    max: d.vec3f
});

export function aabbCylinder(pa: d.v3f, pb: d.v3f, ra: number) {
    "use gpu";
    const a = pb - pa;
    const e = d.f32(ra) * std.sqrt(1.0 - a * a / std.dot(a, a));
    return AABB({
        min: std.min(pa, pb) - e,
        max: std.max(pa, pb) + e
    });
}

export function aabbSphere(center: d.v3f, radius: number, smoothness: number) {
    "use gpu";
    const r = d.vec3f(radius);
    return AABB({
        min: center - (r * d.f32(1) + smoothness),
        max: center + (r * d.f32(1) + smoothness)
    });
}

export function aabbCube(center: d.v3f, halfSize: number) {
    "use gpu";
    const e = d.vec3f(halfSize);
    return AABB({
        min: center - e,
        max: center + e
    });
}

export function rayAABBIntersection(rayOrigin: d.v3f, rayDir: d.v3f, aabb: d.Infer<typeof AABB>): number {
    "use gpu";

    const tMin = d.vec3f(
        (aabb.min.x - rayOrigin.x) / rayDir.x,
        (aabb.min.y - rayOrigin.y) / rayDir.y,
        (aabb.min.z - rayOrigin.z) / rayDir.z,
    );
    const tMax = d.vec3f(
        (aabb.max.x - rayOrigin.x) / rayDir.x,
        (aabb.max.y - rayOrigin.y) / rayDir.y,
        (aabb.max.z - rayOrigin.z) / rayDir.z,
    );

    const tNear = std.max(
        std.min(tMin.x, tMax.x),
        std.min(tMin.y, tMax.y),
        std.min(tMin.z, tMax.z),
    );
    const tFar = std.min(
        std.max(tMin.x, tMax.x),
        std.max(tMin.y, tMax.y),
        std.max(tMin.z, tMax.z),
    );

    if (tFar > 0 && tNear <= tFar) {
        return std.max(tNear, 0);
    }

    return -1;
};
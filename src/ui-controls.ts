import { d } from "typegpu";
import { setDebugBoundings, setSmoothness, smoothnessUniform } from "./main";

export function PrepareUI() {
    document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
    <canvas id="canvas" width="1920" height="1920"></canvas>

    <div>
    <label>K: <input id="k" type="range" min="0.0001" max="2" step="0.01" value="0.1"></label>
    <label>Debug Boundings: <input id="debugBoundings" type="checkbox"></label>
    </div>
    `;

    document.querySelectorAll<HTMLInputElement>("input").forEach(input => {
        input.addEventListener("input", () => {
            updateUniforms();
        });
    });

    function updateUniforms() {
        const k = parseFloat((document.querySelector<HTMLInputElement>("#k")!).value);
        const debugBoundings = (document.querySelector<HTMLInputElement>("#debugBoundings")!).checked;
        const debugBoundingsValue = debugBoundings ? 1 : 0;

        setSmoothness(k);
        setDebugBoundings(debugBoundingsValue);
    }

    updateUniforms();
}
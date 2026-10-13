import * as THREE from "three";
import { STLExporter } from "three/examples/jsm/exporters/STLExporter.js";

/** Client-side export of the already-loaded model ? no backend round
 *  trip: the geometry is serialized client-side with each mesh's world
 *  transform baked into the output. STL is triangle soup by definition,
 *  so world matrices must only be current for the frame ? STLExporter
 *  reads them but no render loop update may have happened yet on the
 *  same tick as a load. STL is unitless and carries scene coordinates
 *  as-is. */
export function exportScene(root: THREE.Object3D): Blob {
	root.updateWorldMatrix(true, true);
	const dv = new STLExporter().parse(root, { binary: true });
	return new Blob([dv.buffer], { type: "model/stl" });
}

/** Save a Blob through a temporary anchor click. */
export function downloadBlob(blob: Blob, filename: string): void {
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	a.remove();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}

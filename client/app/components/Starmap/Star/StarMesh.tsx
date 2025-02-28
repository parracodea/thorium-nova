import React, { forwardRef, Suspense } from "react";
import {
	TextureLoader,
	RepeatWrapping,
	type Mesh,
	type ShaderMaterial,
	type Color,
	Vector3,
	AdditiveBlending,
	type Group,
	type Texture,
} from "three";
import LensFlare from "./lensFlare";
import { fragment, vertex } from "./shaders";
import getUniforms from "./uniforms";
import ColorUtil from "chroma-js";
import { useTexture } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useGetStarmapStore } from "../starmapStore";

import texturePath from "./textures/01_Texture.jpg";
import spritePath from "./textures/Star.svg";
const distanceVector = new Vector3();

const SPRITE_SCALE_FACTOR = 50;
const Star: React.FC<{
	color1?: number | Color;
	color2?: number | Color;
	size?: number;
	position?: Vector3 | [number, number, number];
	noLensFlare?: boolean;
	showSprite?: boolean;
	userData?: any;
}> = ({
	color1 = 0x224488,
	color2 = 0xf6fcff,
	size,
	noLensFlare,
	showSprite,
	userData,
	...props
}) => {
	const useStarmapStore = useGetStarmapStore();
	const isViewscreen = useStarmapStore(
		(store) => store.viewingMode === "viewscreen",
	);

	const texture = React.useMemo(() => {
		const loader = new TextureLoader();
		const texture = loader.load(texturePath);
		texture.wrapS = RepeatWrapping;
		texture.wrapT = RepeatWrapping;
		return texture;
	}, []);
	const uniforms = React.useMemo(
		() => getUniforms({ map: texture, color1, color2 }),
		[color1, color2, texture],
	);
	const shader = React.useRef<Mesh>(null);
	const starMesh = React.useRef<Group>(null);
	const starSprite = React.useRef<Group>(null);

	useFrame(({ camera }) => {
		shader.current?.quaternion.copy(camera.quaternion);
		if (shader.current) {
			const mat = shader.current.material as ShaderMaterial;
			mat.uniforms.time.value += 0.03;
			mat.uniforms.color1.value = color1;
			mat.uniforms.color2.value = color2;
		}

		const distance = camera.position.distanceTo(
			distanceVector.set(camera.position.x, 0, camera.position.z),
		);
		if (starSprite.current && starMesh.current) {
			if (
				size &&
				distance / size > 100 &&
				(useStarmapStore.getState().viewingMode === "core" || showSprite)
			) {
				starSprite.current.visible = true;
				starMesh.current.visible = false;
			} else {
				starSprite.current.visible = false;
				starMesh.current.visible = true;
			}
		}
	});
	const color = React.useMemo(() => {
		if (typeof color1 === "number") {
			const color = color1.toString(16);
			return `#${color}`;
		}
		const color = color1.toArray();
		const colorVal = `rgb(${Math.round(color[0] * 255)},${Math.round(
			color[1] * 255,
		)},${Math.round(color[2] * 255)})`;
		return ColorUtil(colorVal).brighten(90).rgb().toString();
	}, [color1]);

	return (
		<group {...props}>
			<pointLight intensity={0.8} decay={2} color={color} castShadow />
			{!isViewscreen && (
				<StarSprite size={size} color1={color1} userData={userData} />
			)}

			<group ref={starMesh}>
				<mesh ref={shader} userData={userData}>
					<circleGeometry attach="geometry" args={[1, 8, 8]} />
					<shaderMaterial
						attach="material"
						fragmentShader={fragment}
						vertexShader={vertex}
						uniforms={uniforms}
						blending={AdditiveBlending}
						transparent
						depthTest={false}
					/>
				</mesh>
				<mesh>
					<sphereGeometry attach="geometry" args={[0.5, 32, 32]} />
					<meshBasicMaterial attach="material" color={0x000000} />
				</mesh>
			</group>
			{/* {viewingMode !== "core" && !noLensFlare && <LensFlare />} */}
		</group>
	);
};

export default Star;

export const StarSprite = forwardRef<
	Group,
	{ size?: number; color1: Color | number; userData: any }
>(({ size = 1, color1, userData }, starSprite) => {
	const spriteScale = 1 / size / SPRITE_SCALE_FACTOR;

	return (
		<group ref={starSprite} scale={[spriteScale, spriteScale, spriteScale]}>
			<Suspense fallback={null}>
				<StarSpriteInner color1={color1} userData={userData} />
			</Suspense>
		</group>
	);
});

StarSprite.displayName = "StarSprite";

const StarSpriteInner = ({
	color1,
	userData,
}: { color1: Color | number; userData: any }) => {
	const spriteMap = useTexture(spritePath) as Texture;
	return (
		<sprite userData={userData}>
			<spriteMaterial
				attach="material"
				map={spriteMap}
				color={color1}
				sizeAttenuation={false}
			/>
		</sprite>
	);
};

import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Cartesian2 from "terriajs-cesium/Source/Core/Cartesian2";
import Cartesian3 from "terriajs-cesium/Source/Core/Cartesian3";
import Cartographic from "terriajs-cesium/Source/Core/Cartographic";
import Color from "terriajs-cesium/Source/Core/Color";
import Ellipsoid from "terriajs-cesium/Source/Core/Ellipsoid";
import HeadingPitchRoll from "terriajs-cesium/Source/Core/HeadingPitchRoll";
import Ray from "terriajs-cesium/Source/Core/Ray";
import sampleTerrainMostDetailed from "terriajs-cesium/Source/Core/sampleTerrainMostDetailed";
import ScreenSpaceEventHandler from "terriajs-cesium/Source/Core/ScreenSpaceEventHandler";
import ScreenSpaceEventType from "terriajs-cesium/Source/Core/ScreenSpaceEventType";
import CallbackProperty from "terriajs-cesium/Source/DataSources/CallbackProperty";
import CustomDataSource from "terriajs-cesium/Source/DataSources/CustomDataSource";
import Entity from "terriajs-cesium/Source/DataSources/Entity";
import DebugCameraPrimitive from "terriajs-cesium/Source/Scene/DebugCameraPrimitive";
import DebugModelMatrixPrimitive from "terriajs-cesium/Source/Scene/DebugModelMatrixPrimitive";
import Scene from "terriajs-cesium/Source/Scene/Scene";
import TerriaError from "../../../Core/TerriaError";
import Cesium from "../../../Models/Cesium";
import raiseErrorToUser from "../../../Models/raiseErrorToUser";
import ViewState from "../../../ReactViewModels/ViewState";
import DropPedestrian from "./DropPedestrian";

type PropsType = {
  viewState: ViewState;
};

const PedestrianView: React.FC<PropsType> = props => {
  const { viewState } = props;
  const [t] = useTranslation();
  const [initialPosition, setInitialPosition] = useState<
    Cartesian3 | undefined
  >();

  const terria = viewState.terria;
  const currentViewer = terria.currentViewer;
  if (!(currentViewer instanceof Cesium)) {
    raiseErrorToUser(
      terria,
      new TerriaError({
        title: t("pedestrianView.requiresCesium.title"),
        message: t("pedestrianView.requiresCesium.message")
      })
    );
    return null;
  }

  const cesium = currentViewer;

  return (
    <>
      {!initialPosition && (
        <DropPedestrian cesium={cesium} afterDrop={setInitialPosition} />
      )}
      {initialPosition && (
        <MovementControls cesium={cesium} initialPosition={initialPosition} />
      )}
    </>
  );
};

type MovementControlsProps = {
  cesium: Cesium;
  initialPosition: Cartesian3;
};

const MovementControls: React.FC<MovementControlsProps> = props => {
  useEffect(() => {
    const { cesium } = props;
    const scene = cesium.scene;
    const eventHandler = new ScreenSpaceEventHandler(cesium.scene.canvas);

    scene.screenSpaceCameraController.enableInputs = false;

    const movements = new Set();
    const keyMap: Record<string, string> = {
      KeyW: "moveForward",
      KeyA: "moveLeft",
      KeyS: "moveBackward",
      KeyD: "moveRight",
      Space: "moveUp",
      ShiftLeft: "moveDown",
      ShiftRight: "moveDown"
    };

    const onKeyDown = (ev: KeyboardEvent) => {
      if (keyMap[ev.code] !== undefined) movements.add(keyMap[ev.code]);
    };

    const onKeyUp = (ev: KeyboardEvent) => {
      if (keyMap[ev.code] !== undefined) movements.delete(keyMap[ev.code]);
    };

    let startMousePosition: Cartesian2 | undefined;
    let mousePosition: Cartesian2 | undefined;
    eventHandler.setInputAction(movement => {
      mousePosition = startMousePosition = movement.position.clone();
      movements.add("look");
    }, ScreenSpaceEventType.LEFT_DOWN);

    eventHandler.setInputAction(movement => {
      mousePosition = movement.endPosition.clone();
    }, ScreenSpaceEventType.MOUSE_MOVE);

    eventHandler.setInputAction(() => {
      movements.delete("look");
      startMousePosition = mousePosition = undefined;
    }, ScreenSpaceEventType.LEFT_UP);

    const animate = () => {
      const camera = cesium.scene.camera;
      const height = camera.positionCartographic.height;
      const moveRate = height / 10;

      movements.forEach(m => {
        let forwardDirection: Cartesian3;
        switch (m) {
          case "moveForward":
            forwardDirection = projectVectorToSurface(
              camera.direction,
              camera.position,
              cesium.scene.globe.ellipsoid
            );
            camera.move(forwardDirection, moveRate);
            break;
          case "moveBackward":
            forwardDirection = projectVectorToSurface(
              camera.direction,
              camera.position,
              cesium.scene.globe.ellipsoid
            );
            camera.move(forwardDirection, -moveRate);
            break;
          case "moveLeft":
            camera.moveLeft(moveRate);
            break;
          case "moveRight":
            camera.moveRight(moveRate);
            break;
          case "moveUp":
            camera.moveUp(moveRate);
            break;
          case "moveDown":
            camera.moveDown(moveRate);
            break;
          case "look":
            if (startMousePosition && mousePosition)
              cameraLook(scene, startMousePosition, mousePosition);
            break;
          default:
            return;
        }

        resurfaceIfUnderground(scene);
      });
    };

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    const disposeAnimation = cesium.cesiumWidget.clock.onTick.addEventListener(
      animate
    );

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      eventHandler.destroy();
      disposeAnimation();
      scene.screenSpaceCameraController.enableInputs = true;
      /* cesium.dataSourceDisplay.dataSources.remove(dataSource); */
    };
  });
  return null;
};

function resurfaceIfUnderground(scene: Scene) {
  const camera = scene.camera;
  sampleTerrainMostDetailed(scene.terrainProvider, [
    camera.positionCartographic.clone()
  ]).then(([terrainPosition]) => {
    const heightFromTerrain =
      camera.positionCartographic.height - terrainPosition.height;
    if (heightFromTerrain < 1) {
      const surfaceOffset = Cartesian3.multiplyByScalar(
        camera.up,
        -heightFromTerrain,
        new Cartesian3()
      );
      Cartesian3.add(camera.position, surfaceOffset, camera.position);
    }
  });
}

/**
 *  Vector = ProjectionOnSurfaceNormal + ProjectionOnSurface
 *
 */
function projectVectorToSurface(
  vector: Cartesian3,
  position: Cartesian3,
  ellipsoid: Ellipsoid
) {
  const surfaceNormal = ellipsoid.geodeticSurfaceNormal(
    position,
    new Cartesian3()
  );
  const magnitudeOfProjectionOnSurfaceNormal = Cartesian3.dot(
    vector,
    surfaceNormal
  );
  const projectionOnSurfaceNormal = Cartesian3.multiplyByScalar(
    surfaceNormal,
    magnitudeOfProjectionOnSurfaceNormal,
    new Cartesian3()
  );
  const projectionOnSurface = Cartesian3.subtract(
    vector,
    projectionOnSurfaceNormal,
    new Cartesian3()
  );
  return projectionOnSurface;
}

function verticalHeightFromTerrain(scene: Scene) {
  return scene.globe.getHeight(scene.camera.positionCartographic);
}

function cameraLook(
  scene: Scene,
  startMousePosition: Cartesian2,
  currentMousePosition: Cartesian2
) {
  const camera = scene.camera;
  const canvas = scene.canvas;
  const width = canvas.width;
  const height = canvas.height;
  const x = (currentMousePosition.x - startMousePosition.x) / width;
  const y = (currentMousePosition.y - startMousePosition.y) / height;
  const lookFactor = 0.05;

  camera.lookRight(x * lookFactor);
  camera.lookUp(y * lookFactor);
}

export default PedestrianView;

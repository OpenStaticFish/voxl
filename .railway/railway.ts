import { defineRailway, github, preserve, project, service } from "railway/iac";

export default defineRailway(() => {
  const voxl = github("OpenStaticFish/voxl", { branch: "master" });

  const game = service("game", {
    source: voxl,
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "Dockerfile" },
    healthcheck: "/",
    healthcheckTimeout: 100,
    replicas: 1,
    env: {
      PORT: preserve(),
    },
  });
  const website = service("website", {
    source: voxl,
    build: { buildEnvironment: "V3", builder: "DOCKERFILE", dockerfilePath: "website/Dockerfile" },
    healthcheck: "/",
    healthcheckTimeout: 100,
    replicas: 1,
    env: {
      PORT: preserve(),
    },
  });

  return project("voxl", {
    resources: [game, website],
  });
});

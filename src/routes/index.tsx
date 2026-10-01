import { createFileRoute } from "@tanstack/react-router";
import { AtlasApp } from "@/components/atlas-app";

export const Route = createFileRoute("/")({ component: AtlasApp });

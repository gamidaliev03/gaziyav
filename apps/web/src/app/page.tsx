import { redirect } from "next/navigation";

// The Mac app has no landing page: the start screen is the list of videos.
export default function Home() {
	redirect("/projects");
}

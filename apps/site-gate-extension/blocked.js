const target = new URLSearchParams(location.search).get("target");
document.querySelector("#target").textContent = target ? `Declined: ${target}` : "No target provided.";


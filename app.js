const PYTHON_RELEASES = {
	3.13: new Date("2024-10-07"),
	3.12: new Date("2023-10-02"),
	3.11: new Date("2022-10-24"),
	"3.10": new Date("2021-10-04"), // js is fun
	3.9: new Date("2020-10-05"),
	3.8: new Date("2019-10-14"),
	3.7: new Date("2018-06-27"),
	3.6: new Date("2016-12-23"),
	3.5: new Date("2015-09-13"),
	3.4: new Date("2014-03-16"),
	3.3: new Date("2012-09-29"),
	3.2: new Date("2011-02-20"),
	3.1: new Date("2009-06-27"),
	"3.0": new Date("2008-12-03"),
	2.7: new Date("2010-07-03"),
	2.6: new Date("2008-10-01"),
};

async function checkPackages() {
	// process textarea input; no validation yet, so random text still generates requests to pypi
	const textarea = document.getElementById("packages");
	let packages = textarea.value
		.trim()
		.split("\n")
		.filter((p) => p.trim())
		.map((pkg) => {
			// Strip version specifiers like ==1.2.3, >=1.0, etc.
			return pkg
				.trim()
				.split(/[=<>!~]/)[0]
				.trim();
		});

	packages = packages.map((pkg) => pkg.split(" ")[0]);
	if (packages.length === 0) {
		alert("Please enter at least one package name");
		return;
	}

	document.getElementById("loading").classList.remove("hidden");
	document.getElementById("results").classList.add("hidden");
	document.getElementById("resultsContainer").innerHTML = "";

	const results = await Promise.all(
		packages.map((pkg) => fetchPackageInfo(pkg)),
	);

	document.getElementById("loading").classList.add("hidden");
	displayResults(results);
}

document.addEventListener("DOMContentLoaded", () => {
	const textarea = document.getElementById("packages");
	const button = document.getElementById("checkButton");

	// apparently platform is deprecated;
	// todo: figure this out
	const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
	const shortcutText = isMac ? "⌘+Enter" : "Ctrl+Enter";
	button.textContent = `Check Maintenance Status (${shortcutText})`;

	textarea.addEventListener("keydown", (e) => {
		// Check for Ctrl+Enter (Windows/Linux) or Cmd+Enter (macOS)
		if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
			e.preventDefault();
			checkPackages();
		}
	});
});

async function fetchPackageInfo(packageName) {
	// at some point rate limiting might break stuff for the user?
	try {
		const response = await fetch(`https://pypi.org/pypi/${packageName}/json`);
		if (!response.ok) {
			throw new Error(`Package ${packageName} not found`);
		}

		const data = await response.json();
		return processPackageData(packageName, data);
	} catch (error) {
		return {
			name: packageName,
			error: error.message,
		};
	}
}

function processPackageData(packageName, data) {
	const info = data.info;
	const releases = Object.keys(data.releases).filter(
		(v) => data.releases[v].length > 0,
	);

	const releaseDates = releases
		.map((version) => {
			const releaseData = data.releases[version];
			if (releaseData && releaseData.length > 0) {
				return {
					version: version,
					date: new Date(releaseData[0].upload_time),
				};
			}
			return null;
		})
		.filter((r) => r !== null)
		.sort((a, b) => b.date - a.date);

	const latestRelease = releaseDates[0];
	const recentReleases = releaseDates.slice(0, 10); // up to 10 latest releases
	const pythonVersions = extractPythonVersions(info);
	const releaseFrequency = calculateReleaseFrequency(releaseDates);
	const pythonAdoptionTime = calculatePythonAdoptionTime(
		packageName,
		releaseDates,
		pythonVersions,
	);

	const projectUrls = extractProjectUrls(info);
	const numDeps = info.requires_dist?.length || "?";

	const maintenanceStatus = calculateMaintenanceStatus(
		latestRelease?.date,
		releaseFrequency,
		pythonVersions,
	);

	return {
		name: packageName,
		version: info.version,
		summary: info.summary,
		numDeps: numDeps,
		home_page: info.home_page,
		projectUrls: projectUrls,
		author: info.author,
		pythonVersions: pythonVersions,
		lastRelease: latestRelease ? latestRelease.date : null,
		recentReleases: recentReleases,
		totalReleases: releaseDates.length,
		releaseFrequency: releaseFrequency,
		pythonAdoptionTime: pythonAdoptionTime,
		maintenanceStatus: maintenanceStatus,
	};
}

function extractProjectUrls(info) {
	const urls = {};

	// Get project_urls if available
	if (info.project_urls) {
		Object.entries(info.project_urls).forEach(([key, url]) => {
			const lowerKey = key.toLowerCase();

			if (
				lowerKey.includes("changelog") ||
				lowerKey.includes("change") ||
				lowerKey.includes("release")
			) {
				urls.changelog = url;
			} else if (
				lowerKey.includes("doc") ||
				lowerKey.includes("documentation")
			) {
				urls.docs = url;
			} else if (lowerKey.includes("home") || lowerKey.includes("website")) {
				urls.homepage = url;
			} else if (
				lowerKey.includes("repo") ||
				lowerKey.includes("source") ||
				lowerKey.includes("github") ||
				lowerKey.includes("gitlab") ||
				lowerKey.includes("bitbucket")
			) {
				urls.repository = url;
			}
		});
	}

	// Fallback to home_page if no homepage in project_urls
	if (!urls.homepage && info.home_page) {
		urls.homepage = info.home_page;
	}

	return urls;
}

function extractPythonVersions(info) {
	const versions = new Set();

	if (info.requires_python) {
		const versionStr = info.requires_python;

		Object.keys(PYTHON_RELEASES).forEach((version) => {
			if (checkVersionCompatibility(version, versionStr)) {
				versions.add(version);
			}
		});
	}

	const classifiers = info.classifiers || [];
	classifiers.forEach((classifier) => {
		const match = classifier.match(
			/Programming Language :: Python :: (\d+\.?\d*)/, // ugh, ugly af
		);
		if (match) {
			versions.add(match[1]);
		}
	});

	return Array.from(versions).sort((a, b) => {
		const [aMajor, aMinor] = a.split(".").map(Number);
		const [bMajor, bMinor] = b.split(".").map(Number);
		if (aMajor !== bMajor) return bMajor - aMajor;
		return (bMinor || 0) - (aMinor || 0);
	});
}

function checkVersionCompatibility(version, requiresStr) {
	if (!requiresStr) return false;

	const requiresStrClean = requiresStr.replace(/\s/g, "");

	if (requiresStrClean.includes(">=")) {
		const minVersion = requiresStrClean.match(/>=([\d.]+)/)?.[1];
		if (minVersion && compareVersions(version, minVersion) >= 0) {
			if (requiresStrClean.includes("<")) {
				const maxVersion = requiresStrClean.match(/<([\d.]+)/)?.[1];
				return !maxVersion || compareVersions(version, maxVersion) < 0;
			}
			return true;
		}
	}

	return false;
}

function compareVersions(v1, v2) {
	const parts1 = v1.split(".").map(Number);
	const parts2 = v2.split(".").map(Number);

	for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
		const part1 = parts1[i] || 0;
		const part2 = parts2[i] || 0;
		if (part1 > part2) return 1;
		if (part1 < part2) return -1;
	}
	return 0;
}

function calculateReleaseFrequency(releaseDates) {
	if (releaseDates.length < 2) return null;

	const recentReleases = releaseDates.slice(
		0,
		Math.min(10, releaseDates.length),
	);

	let totalDays = 0;
	for (let i = 0; i < recentReleases.length - 1; i++) {
		const daysDiff =
			(recentReleases[i].date - recentReleases[i + 1].date) /
			(1000 * 60 * 60 * 24);
		totalDays += daysDiff;
	}

	return Math.round(totalDays / (recentReleases.length - 1));
}

function calculatePythonAdoptionTime(
	packageName,
	releaseDates,
	supportedVersions,
) {
	const adoptionTimes = {};

	// biome-ignore lint/complexity/noForEach: <explanation>
	Object.entries(PYTHON_RELEASES).forEach(([pyVersion, pyReleaseDate]) => {
		// 3.9 is currently at EOL, so we just care about 3.9 and above
		const [major, minor] = pyVersion.split(".").map(Number);
		if (major < 3 || (major === 3 && minor < 9)) {
			return;
		}

		if (supportedVersions.includes(pyVersion)) {
			const firstSupportingRelease = releaseDates.find((release) => {
				return release.date >= pyReleaseDate;
			});

			if (firstSupportingRelease) {
				const daysDiff = Math.round(
					(firstSupportingRelease.date - pyReleaseDate) / (1000 * 60 * 60 * 24),
				);
				adoptionTimes[pyVersion] = { days: daysDiff, supported: true };
			} else {
				// Supported but no release data found
				adoptionTimes[pyVersion] = { supported: false, noData: true };
			}
		} else {
			// Mark as not supported
			adoptionTimes[pyVersion] = { supported: false };
		}
	});

	return adoptionTimes;
}

function calculateMaintenanceStatus(
	lastReleaseDate,
	releaseFrequency,
	pythonVersions,
) {
	if (!lastReleaseDate) return "unknown";

	// Get the two latest Python versions
	const latestPythonVersions = Object.keys(PYTHON_RELEASES)
		.filter((v) => v.startsWith("3."))
		.sort((a, b) => {
			const [aMajor, aMinor] = a.split(".").map(Number);
			const [bMajor, bMinor] = b.split(".").map(Number);
			if (aMajor !== bMajor) return bMajor - aMajor;
			return bMinor - aMinor;
		})
		.slice(0, 2);

	// Check if package supports at least the second latest Python version
	const supportsSecondLatest = pythonVersions.includes(latestPythonVersions[1]);

	// If doesn't support second latest Python version, it's poor maintenance
	if (!supportsSecondLatest) {
		return "poor";
	}

	const daysSinceLastRelease =
		(new Date() - lastReleaseDate) / (1000 * 60 * 60 * 24);

	// todo: enum these statuses
	if (daysSinceLastRelease < 180) {
		return "active";
	} else if (daysSinceLastRelease < 365) {
		return "moderate";
	} else {
		return "poor";
	}
}

function displayResults(results) {
	const container = document.getElementById("resultsContainer");
	container.innerHTML = "";

	results.forEach((pkg) => {
		if (pkg.error) {
			container.innerHTML += createErrorCard(pkg);
		} else {
			container.innerHTML += createPackageCard(pkg);
		}
	});

	document.getElementById("results").classList.remove("hidden");
}

function createErrorCard(pkg) {
	return `
        <div class="error-card">
            <div class="package-name">${pkg.name}</div>
            <div style="margin-top: 10px; color: #c62828;">
                Error: ${pkg.error}
            </div>
        </div>
    `;
}

function createPackageCard(pkg) {
	const statusClass = {
		active: "status-good",
		moderate: "status-warning",
		poor: "status-poor",
		unknown: "status-warning",
	}[pkg.maintenanceStatus];

	const statusText = {
		active: "Actively Maintained",
		moderate: "Moderately Maintained",
		poor: "Poor Maintenance",
		unknown: "Unknown Status",
	}[pkg.maintenanceStatus];

	const lastReleaseText = pkg.lastRelease
		? `${pkg.lastRelease.toISOString().split("T")[0]} (${Math.round((new Date() - pkg.lastRelease) / (1000 * 60 * 60 * 24))} days ago)`
		: "Unknown";

	const frequencyText = pkg.releaseFrequency
		? `Every ${pkg.releaseFrequency} days (average over 10 latest)`
		: "Not enough data";

	const pythonVersionsHtml =
		pkg.pythonVersions.length > 0
			? pkg.pythonVersions
					.map((v) => `<span class="python-version">Python ${v}</span>`)
					.join("")
			: '<span style="color: #999;">No version info available</span>';

	let adoptionTimeHtml = "";
	if (Object.keys(pkg.pythonAdoptionTime).length > 0) {
		const adoptionItems = Object.entries(pkg.pythonAdoptionTime)
			.sort((a, b) => {
				const [aMajor, aMinor] = a[0].split(".").map(Number);
				const [bMajor, bMinor] = b[0].split(".").map(Number);
				if (bMajor !== aMajor) return bMajor - aMajor;
				return bMinor - aMinor;
			})
			.map(([version, data]) => {
				if (data.supported && data.days !== undefined && data.days < 180) {
					return `Python ${version}: maybe OK (${data.days} days)`;
				} else if (
					data.supported &&
					data.days !== undefined &&
					data.days > 180
				) {
					return `Python ${version}: likely OK (${data.days} days)`;
				} else {
					return `Python ${version}: <span class="emoji">❌</span> not OK`;
				}
			})
			.join("<br>");
		adoptionTimeHtml = adoptionItems;
	} else {
		adoptionTimeHtml = "No adoption data available";
	}

	// Build project links HTML
	const projectLinksHtml = [];
	if (pkg.projectUrls) {
		if (pkg.projectUrls.homepage) {
			projectLinksHtml.push(
				`<a href="${pkg.projectUrls.homepage}" target="_blank">HOMEPAGE</a>`,
			);
		}
		if (pkg.projectUrls.repository) {
			projectLinksHtml.push(
				`<a href="${pkg.projectUrls.repository}" target="_blank">REPOSITORY</a>`,
			);
		}
		if (pkg.projectUrls.docs) {
			projectLinksHtml.push(
				`<a href="${pkg.projectUrls.docs}" target="_blank">DOCS</a>`,
			);
		}
		if (pkg.projectUrls.changelog) {
			projectLinksHtml.push(
				`<a href="${pkg.projectUrls.changelog}" target="_blank">CHANGELOG</a>`,
			);
		}
	}

	return `
        <div class="package-card">
            <div class="package-header">
                <div>
                    <span class="package-name">${pkg.name}</span>
                    ${
											projectLinksHtml.length > 0
												? `<div class="project-links">${projectLinksHtml.join(" | ")}</div>`
												: ""
										}
                </div>
                <div style="display: flex; gap: 10px; align-items: center;">
                    <span class="package-version">v${pkg.version}</span>
                    <span class="status-badge ${statusClass}">${statusText}</span>
                </div>
            </div>

            ${pkg.summary ? `<div style="margin-bottom: 15px; color: #666; font-style: italic;">${pkg.summary}</div>` : ""}

            <div class="package-details">
                <div class="detail-item">
                    <div class="detail-label">Claimed (!) Supported Python Versions</div>
                    <div class="python-versions">
                        ${pythonVersionsHtml}
                    </div>
                </div>

                <div class="detail-item">
                    <div class="detail-label">Python Version Adoption</div>
                    <div class="detail-value" style="font-size: 0.95em; line-height: 1.5;">
                        ${adoptionTimeHtml}
                    </div>
                </div>

                <div class="detail-item">
                    <div class="detail-label">Recent Releases</div>
                    <div class="detail-value release-list">
                        ${
													pkg.recentReleases
														? pkg.recentReleases
																.map(
																	(release, idx) =>
																		`${release.version}: ${release.date.toISOString().split("T")[0]}`,
																)
																.join("<br>")
														: "No release data"
												}
                    </div>
                </div>

                <div class="detail-item">
                    <div class="detail-label">Release Frequency</div>
                    <div class="detail-value">${frequencyText}</div>
                </div>

                <div class="detail-item">
                    <div class="detail-label">Total Releases</div>
                    <div class="detail-value">${pkg.totalReleases}</div>
                </div>

                <div class="detail-item">
                    <div class="detail-label">Number of dependencies</div>
                    <div class="detail-value">${pkg.numDeps}</div>
                </div>

            </div>
        </div>
    `;
}

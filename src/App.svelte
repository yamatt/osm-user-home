<script>
  import { onMount } from "svelte";

  /** @type {string} */
  let username = "";
  /** @type {string} */
  let status = "";
  /** @type {boolean} */
  let loading = false;
  /** @type {number} */
  let changesetLimit = 100;
  /** @type {boolean} */
  let hasUncommittedUsername = false;
  /** @type {number} */
  let totalEdits = 0;
  /** @type {string} */
  let predCoords = "";
  /** @type {string} */
  let predAddress = "";
  /** @type {boolean} */
  let resultsVisible = false;

  /** @type {import("leaflet").Map | undefined} */
  let map;
  /** @type {HTMLDivElement | null} */
  let mapElement = null;
  /** @type {typeof import("leaflet") | undefined} */
  let L;
  /** @type {import("leaflet").LayerGroup | undefined} */
  let markersGroup;

  onMount(() => {
    username = new URLSearchParams(window.location.hash.slice(1)).get("username") || "";

    const handlePopState = () => {
      username = new URLSearchParams(window.location.hash.slice(1)).get("username") || "";
      hasUncommittedUsername = false;

      if (username.trim() && markersGroup) {
        analyzeUser();
      } else {
        loading = false;
        status = "";
        totalEdits = 0;
        predCoords = "";
        predAddress = "";
        resultsVisible = false;
        markersGroup?.clearLayers();
      }
    };

    window.addEventListener("popstate", handlePopState);

    let disposed = false;
    async function initializeMap() {
      // Dynamic import to ensure Leaflet only runs in browser environment
      L = await import("leaflet");
      if (disposed || !mapElement) return;

      map = L.map(mapElement).setView([20, 0], 2);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "© OpenStreetMap contributors",
      }).addTo(map);

      markersGroup = L.layerGroup().addTo(map);
    }

    void initializeMap();

    return () => {
      disposed = true;
      window.removeEventListener("popstate", handlePopState);
    };
  });

  /**
   * @param {Event & { currentTarget: HTMLInputElement }} event
   */
  function updateUsernameHash(event) {
    // These are temporary URL-building values, not reactive component state.
    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const params = new URLSearchParams();
    const value = event.currentTarget.value.trim();

    if (value) params.set("username", value);

    // eslint-disable-next-line svelte/prefer-svelte-reactivity
    const url = new URL(window.location.href);
    url.hash = params.toString();
    if (hasUncommittedUsername) {
      window.history.replaceState(null, "", url);
    } else {
      window.history.pushState(null, "", url);
      hasUncommittedUsername = true;
    }
  }

  /**
   * @param {number} lat
   * @param {number} lon
   */
  async function getAddressFromCoords(lat, lon) {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}`;
      const response = await fetch(url, {
        headers: { "Accept-Language": "en" },
      });
      if (!response.ok) return "Address lookup failed";

      const data = await response.json();
      const addr = data.address || {};

      const houseNumber = addr.house_number || "";
      const road =
        addr.road || addr.pedestrian || addr.street || addr.suburb || "";
      const city = addr.city || addr.town || addr.village || addr.county || "";
      const postcode = addr.postcode || "";
      const country = addr.country || "";

      if (houseNumber && road) {
        return `${houseNumber} ${road}, ${city} ${postcode}, ${country}`.trim();
      } else if (road) {
        return `Near ${road}, ${city} ${postcode}, ${country}`.trim();
      } else if (data.display_name) {
        return data.display_name;
      } else {
        return "Address unknown";
      }
    } catch {
      return "Address lookup error";
    }
  }

  async function analyzeUser() {
    if (!username.trim()) {
      alert("Please enter an OSM username");
      return;
    }

    if (
      !Number.isInteger(changesetLimit) ||
      changesetLimit < 1 ||
      changesetLimit > 10000
    ) {
      status = "Choose a whole number of changesets between 1 and 10,000.";
      return;
    }

    loading = true;
    status = "Fetching changeset history from OSM API...";
    resultsVisible = false;
    predAddress = "Searching Nominatim...";
    if (markersGroup) {
      markersGroup.clearLayers();
    }

    try {
      /** @type {[number, number][]} */
      const points = [];
      let loadedChangesets = 0;
      let timeCursor = "";

      while (loadedChangesets < changesetLimit) {
        const pageLimit = Math.min(100, changesetLimit - loadedChangesets);
        // eslint-disable-next-line svelte/prefer-svelte-reactivity
        const params = new URLSearchParams({
          display_name: username.trim(),
          closed: "true",
          limit: String(pageLimit),
        });
        if (timeCursor) {
          params.set("time", `2000-01-01T00:00:00Z,${timeCursor}`);
        }

        const response = await fetch(
          `https://api.openstreetmap.org/api/0.6/changesets?${params}`,
        );
        if (!response.ok) {
          throw new Error(
            `Changeset request failed (HTTP ${response.status})`,
          );
        }

        const xmlText = await response.text();
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, "text/xml");
        if (xmlDoc.querySelector("parsererror")) {
          throw new Error("OSM API returned an invalid changeset response");
        }

        const changesets = Array.from(
          xmlDoc.getElementsByTagName("changeset"),
        );
        if (changesets.length === 0) break;

        let oldestCreatedAt = Number.POSITIVE_INFINITY;
        for (const cs of changesets) {
          const createdAt = Date.parse(cs.getAttribute("created_at") || "");
          if (!Number.isFinite(createdAt)) {
            throw new Error("A changeset response is missing its creation time");
          }
          oldestCreatedAt = Math.min(oldestCreatedAt, createdAt);

          const minLatText = cs.getAttribute("min_lat");
          const maxLatText = cs.getAttribute("max_lat");
          const minLonText = cs.getAttribute("min_lon");
          const maxLonText = cs.getAttribute("max_lon");

          if (minLatText && maxLatText && minLonText && maxLonText) {
            const lat =
              (parseFloat(minLatText) + parseFloat(maxLatText)) / 2;
            const lon =
              (parseFloat(minLonText) + parseFloat(maxLonText)) / 2;
            points.push([lat, lon]);
          }
        }

        loadedChangesets += changesets.length;
        status = `Fetched ${loadedChangesets} of ${changesetLimit} changesets...`;

        if (
          changesets.length < pageLimit ||
          loadedChangesets >= changesetLimit
        ) {
          break;
        }

        timeCursor = new Date(oldestCreatedAt - 1).toISOString();
      }

      if (points.length === 0) {
        status = "No closed edits found for this user.";
        loading = false;
        return;
      }

      const leaflet = L;
      const markerLayer = markersGroup;
      const mapInstance = map;

      if (!leaflet || !markerLayer || !mapInstance) {
        status = "Map is still initializing. Please try again.";
        loading = false;
        return;
      }

      // Plot raw edit bounding box centers
      points.forEach((pt) => {
        leaflet.circleMarker(pt, {
          radius: 3,
          color: "#94a3b8",
          fillOpacity: 0.5,
        }).addTo(markerLayer);
      });

      // Spatial Extremity Trimming via Interquartile Range (IQR 25%-75%)
      const lats = points.map((p) => p[0]).sort((a, b) => a - b);
      const lons = points.map((p) => p[1]).sort((a, b) => a - b);

      /**
       * @param {number[]} arr
       * @param {number} p
       */
      const getPercentile = (arr, p) => arr[Math.floor(arr.length * p)];

      const q25_lat = getPercentile(lats, 0.25);
      const q75_lat = getPercentile(lats, 0.75);
      const q25_lon = getPercentile(lons, 0.25);
      const q75_lon = getPercentile(lons, 0.75);

      let filtered = points.filter(
        (p) =>
          p[0] >= q25_lat &&
          p[0] <= q75_lat &&
          p[1] >= q25_lon &&
          p[1] <= q75_lon,
      );
      if (filtered.length === 0) filtered = points;

      const homeLat = filtered.reduce((acc, p) => acc + p[0], 0) / filtered.length;
      const homeLon = filtered.reduce((acc, p) => acc + p[1], 0) / filtered.length;

      totalEdits = loadedChangesets;
      predCoords = `${homeLat.toFixed(4)}, ${homeLon.toFixed(4)}`;
      status = "";
      resultsVisible = true;
      hasUncommittedUsername = false;

      // Reverse geocode predicted center point
      predAddress = await getAddressFromCoords(homeLat, homeLon);

      leaflet
        .marker([homeLat, homeLon])
        .addTo(markerLayer)
        .bindPopup(
          `<b>Predicted Home Area</b><br>${predAddress}<br><i>(${homeLat.toFixed(5)}, ${homeLon.toFixed(5)})</i>`,
        )
        .openPopup();

      mapInstance.setView([homeLat, homeLon], 14);
    } catch (err) {
      status = "Error: " + (err instanceof Error ? err.message : String(err));
    } finally {
      loading = false;
    }
  }
</script>

<div class="app-container">
  <div id="sidebar">
    <h2>OSM Home Predictor</h2>
    <p class="subtitle">
      Svelte app that trims spatial extremities from OSM changesets to estimate
      primary location & physical address.
    </p>

    <label for="username"><b>OSM Username:</b></label>
    <input
      type="text"
      id="username"
      bind:value={username}
      on:input={updateUsernameHash}
      placeholder="e.g. pascar"
      on:keydown={(e) => e.key === "Enter" && analyzeUser()}
    />

    <label for="changeset-limit"><b>Changesets to load:</b></label>
    <input
      type="number"
      id="changeset-limit"
      bind:value={changesetLimit}
      min="1"
      max="10000"
      step="1"
      aria-describedby="changeset-limit-help"
    />
    <div id="changeset-limit-help">
      Defaults to 100; loads in batches of 100, up to 10,000.
    </div>

    <button on:click={analyzeUser} disabled={loading}>
      {loading ? "Analyzing..." : "Predict Location & Address"}
    </button>

    {#if status}
      <div id="status">{status}</div>
    {/if}

    {#if resultsVisible}
      <div id="results">
        <div class="stat-card">
          <div class="stat-title">Total Changesets</div>
          <div class="stat-value">{totalEdits}</div>
        </div>
        <div class="stat-card">
          <div class="stat-title">Predicted Home Coordinates</div>
          <div class="stat-value">{predCoords}</div>
        </div>
        <div class="stat-card">
          <div class="stat-title">Estimated House Address</div>
          <div class="stat-value">{predAddress}</div>
        </div>
        <div class="stat-card">
          <div class="stat-title">Filtering Method</div>
          <div class="stat-value">Interquartile Range (IQR 25%-75%)</div>
        </div>
      </div>
    {/if}
  </div>

  <div id="map" bind:this={mapElement}></div>
</div>

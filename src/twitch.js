let accessToken = null;
let tokenExpiresAt = 0;

function requireTwitchCredentials() {
  if (!process.env.TWITCH_CLIENT_ID || !process.env.TWITCH_CLIENT_SECRET) {
    throw new Error(
      "TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET must be set.",
    );
  }
}

async function getAccessToken() {
  requireTwitchCredentials();

  const now = Date.now();

  if (accessToken && now < tokenExpiresAt - 60_000) {
    return accessToken;
  }

  const params = new URLSearchParams({
    client_id: process.env.TWITCH_CLIENT_ID,
    client_secret: process.env.TWITCH_CLIENT_SECRET,
    grant_type: "client_credentials",
  });

  const response = await fetch(
    `https://id.twitch.tv/oauth2/token?${params.toString()}`,
    { method: "POST" },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Failed to get Twitch app access token (${response.status}): ${body}`,
    );
  }

  const data = await response.json();

  accessToken = data.access_token;
  tokenExpiresAt = Date.now() + Number(data.expires_in) * 1000;

  return accessToken;
}

async function twitchFetch(url) {
  let token = await getAccessToken();

  const makeRequest = (bearerToken) =>
    fetch(url, {
      headers: {
        "Client-Id": process.env.TWITCH_CLIENT_ID,
        Authorization: `Bearer ${bearerToken}`,
      },
    });

  let response = await makeRequest(token);

  if (response.status === 401) {
    accessToken = null;
    tokenExpiresAt = 0;
    token = await getAccessToken();
    response = await makeRequest(token);
  }

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Twitch API request failed (${response.status}): ${body}`,
    );
  }

  return response.json();
}

export async function getTwitchUser(username) {
  const cleanUsername = username.toLowerCase();

  const data = await twitchFetch(
    `https://api.twitch.tv/helix/users?login=${encodeURIComponent(cleanUsername)}`,
  );

  return data.data[0] ?? null;
}

export async function getStream(username) {
  const cleanUsername = username.toLowerCase();

  const data = await twitchFetch(
    `https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(cleanUsername)}`,
  );

  return data.data[0] ?? null;
}

export async function getStreams(userIds) {
  if (userIds.length === 0) {
    return [];
  }

  const streams = [];

  for (let i = 0; i < userIds.length; i += 100) {
    const chunk = userIds.slice(i, i + 100);
    const params = new URLSearchParams();

    for (const userId of chunk) {
      params.append("user_id", userId);
    }

    const data = await twitchFetch(
      `https://api.twitch.tv/helix/streams?${params.toString()}`,
    );

    streams.push(...data.data);
  }

  return streams;
}

export async function getLatestArchiveVod(userId, messageDate) {
  const data=await twitchFetch(`https://api.twitch.tv/helix/videos?user_id=${encodeURIComponent(userId)}&type=archive&first=20`);
  const videos=data.data||[];
  const candidates=videos.filter(v=>+new Date(v.created_at)<=+messageDate);
  // A VOD cannot be reliably matched using creation time alone. Return only when its
  // known duration actually covers the message timestamp.
  const seconds=s=>{let total=0;for(const [,n,u] of s.matchAll(/(\d+)([hms])/g))total+=Number(n)*({h:3600,m:60,s:1}[u]);return total};
  const found=candidates.find(v=>+messageDate < +new Date(v.created_at)+seconds(v.duration)*1000);
  return found?.id||null;
}

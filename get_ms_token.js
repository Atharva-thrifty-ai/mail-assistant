require('dotenv').config();
const msal = require('@azure/msal-node');

// 1. Verify we have the required keys in .env
if (!process.env.MS_CLIENT_ID || !process.env.MS_TENANT_ID) {
    console.error("ERROR: Please make sure MS_CLIENT_ID and MS_TENANT_ID are set in your .env file!");
    process.exit(1);
}

// 2. Configure Microsoft Authentication
const config = {
    auth: {
        clientId: process.env.MS_CLIENT_ID,
        authority: `https://login.microsoftonline.com/${process.env.MS_TENANT_ID}`,
    }
};

// We use a PublicClientApplication because this is a local script, not the web server.
const pca = new msal.PublicClientApplication(config);

const deviceCodeRequest = {
    deviceCodeCallback: (response) => {
        console.log("\n=======================================================");
        console.log("ACTION REQUIRED:");
        console.log(response.message);
        console.log("=======================================================\n");
    },
    // offline_access is the magic scope that forces Microsoft to give us a Refresh Token
    scopes: ["offline_access", "Mail.Read"],
};

console.log("Starting Microsoft authentication flow...");

// 3. Initiate the Device Code login flow
pca.acquireTokenByDeviceCode(deviceCodeRequest).then((response) => {
    
    // Microsoft hides the Refresh Token deep inside its internal cache. We have to extract it.
    const tokenCache = JSON.parse(pca.getTokenCache().serialize());
    let refreshTokenSecret = null;
    
    if (tokenCache && tokenCache.RefreshToken) {
        // Grab the first refresh token saved in the cache
        const tokens = Object.values(tokenCache.RefreshToken);
        if (tokens.length > 0) {
            refreshTokenSecret = tokens[0].secret;
        }
    }
    
    if (refreshTokenSecret) {
        console.log("\n✅ Authentication Successful!\n");
        console.log("=== COPY THE TEXT BELOW AND PASTE IT INTO YOUR .env FILE ===");
        console.log(`MS_REFRESH_TOKEN=${refreshTokenSecret}`);
        console.log("============================================================\n");
    } else {
        console.error("Authentication succeeded, but no Refresh Token was provided by Microsoft.");
    }

}).catch((error) => {
    console.error("\n❌ Authentication Failed:");
    console.error(error);
});

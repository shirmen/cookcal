# CookCal passkey sign-in

The browser uses WebAuthn passkeys. Firebase Cloud Functions verifies each ceremony and exchanges a verified passkey for a Firebase custom token. Firestore write rules accept only verified owner accounts using that custom-token session. Google sign-in remains available only to bootstrap each owner's first passkey.

## Configure and deploy

1. Copy `functions/.env.example` to `functions/.env`.
2. Set `PASSKEY_ORIGIN` to the exact origin serving CookCal, including the scheme and any port. Set `PASSKEY_RP_ID` to that origin's hostname only. For example, a page served at `https://shirmen.github.io/cookcal/` uses origin `https://shirmen.github.io` and RP ID `shirmen.github.io`.
3. Install and deploy:

   ```sh
   npm --prefix functions install
   npx firebase-tools deploy --only functions,firestore:rules
   ```

   Cloud Functions deployment requires the Firebase project to use the Blaze plan.

4. In CookCal, sign in with the existing Google owner account once, then choose **Register your first passkey**. Repeat for each authorized owner email. After registration, sign in with the passkey; Google sign-in alone cannot write recipes or meal plans.

The passkey RP ID is tied to the site hostname. If CookCal moves to another hostname, existing passkeys will not work there; register passkeys again for the new hostname.

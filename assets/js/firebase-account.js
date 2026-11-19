(() => {
  "use strict";

  const config = window.FOODIEHUB_FIREBASE_CONFIG;
  const firebaseSDK = window.firebase;

  if (!config || !firebaseSDK || typeof firebaseSDK.initializeApp !== "function") {
    window.FOODIEHUB_CLOUD = {
      available: false,
      error: "Firebase SDK or configuration is unavailable."
    };
    return;
  }

  try {
    const app = firebaseSDK.apps.length
      ? firebaseSDK.app()
      : firebaseSDK.initializeApp(config);
    const auth = app.auth();
    const db = app.firestore();
    const persistenceReady = auth.setPersistence(firebaseSDK.auth.Auth.Persistence.LOCAL);

    const userRef = user => {
      if (!user || !user.uid) throw new Error("Please sign in again to access your account.");
      return db.collection("users").doc(user.uid);
    };

    const addressFields = [
      "house", "building", "street", "area", "landmark",
      "town", "city", "district", "state", "pincode"
    ];
    const requiredAddressFields = [
      "house", "street", "area", "town", "city", "district", "state"
    ];

    function normalizedAddress(address) {
      const output = {};
      addressFields.forEach(field => {
        output[field] = String(address && address[field] || "").trim();
      });
      return output;
    }

    function isCompleteAddress(address) {
      const value = normalizedAddress(address);
      return requiredAddressFields.every(field => value[field]) &&
        /^[1-9]\d{5}$/.test(value.pincode);
    }

    function sameAddress(left, right) {
      const a = normalizedAddress(left);
      const b = normalizedAddress(right);
      return addressFields.every(field => a[field] === b[field]);
    }

    async function ready() {
      await persistenceReady;
    }

    async function loadAccount(user) {
      await ready();
      const ref = userRef(user);
      const profileSnapshot = await ref.get();
      const addressSnapshot = await ref.collection("addresses").get();
      return {
        exists: profileSnapshot.exists,
        profile: profileSnapshot.exists ? profileSnapshot.data() : {},
        addresses: addressSnapshot.docs.map(doc => ({
          id: doc.id,
          label: doc.data().label || "Home",
          address: doc.data().address || {}
        }))
      };
    }

    async function saveAccount(user, values) {
      await ready();
      if (!auth.currentUser || auth.currentUser.uid !== user.uid) {
        throw new Error("Your sign-in session changed. Please sign in again.");
      }

      const ref = userRef(user);
      const existingProfile = await ref.get();
      const addressDetails = normalizedAddress(values.addressDetails || {});
      const profileData = {
        name: String(values.name || "").trim(),
        email: String(user.email || values.email || "").trim().toLowerCase(),
        phone: String(values.phone || "").replace(/\D/g, "").slice(-10),
        address: String(values.address || "").trim(),
        addressDetails,
        updatedAt: firebaseSDK.firestore.FieldValue.serverTimestamp()
      };

      if (!existingProfile.exists) {
        profileData.createdAt = firebaseSDK.firestore.FieldValue.serverTimestamp();
      }

      await ref.set(profileData, { merge: true });

      let addressSaved = false;
      if (isCompleteAddress(addressDetails)) {
        const collection = ref.collection("addresses");
        const snapshot = await collection.get();
        const duplicate = snapshot.docs.some(doc => sameAddress(doc.data().address, addressDetails));
        if (!duplicate) {
          await collection.add({
            label: String(values.addressLabel || "Home"),
            address: addressDetails,
            createdAt: firebaseSDK.firestore.FieldValue.serverTimestamp(),
            updatedAt: firebaseSDK.firestore.FieldValue.serverTimestamp()
          });
        }
        addressSaved = true;
      }

      const result = await loadAccount(user);
      return { ...result, addressSaved };
    }

    async function deleteAddress(user, addressId) {
      await ready();
      if (!auth.currentUser || auth.currentUser.uid !== user.uid) {
        throw new Error("Please sign in again before removing an address.");
      }
      await userRef(user).collection("addresses").doc(String(addressId)).delete();
    }

    async function signInWithEmail(email, password) {
      await ready();
      const result = await auth.signInWithEmailAndPassword(
        String(email || "").trim(),
        String(password || "")
      );
      return result.user;
    }

    async function registerWithEmail(name, email, password) {
      await ready();
      const result = await auth.createUserWithEmailAndPassword(
        String(email || "").trim(),
        String(password || "")
      );
      if (name) await result.user.updateProfile({ displayName: String(name).trim() });
      return result.user;
    }

    async function signInWithGoogle() {
      await ready();
      const provider = new firebaseSDK.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      try {
        const result = await auth.signInWithPopup(provider);
        return result.user;
      } catch (error) {
        if (error && error.code === "auth/popup-blocked") {
          await auth.signInWithRedirect(provider);
          return null;
        }
        throw error;
      }
    }

    async function linkGoogleToCurrentUser() {
      await ready();
      if (!auth.currentUser) throw new Error("Sign in before linking another method.");
      const provider = new firebaseSDK.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      try {
        const result = await auth.currentUser.linkWithPopup(provider);
        return result.user;
      } catch (error) {
        if (error && error.code === "auth/popup-blocked") {
          await auth.currentUser.linkWithRedirect(provider);
          return null;
        }
        throw error;
      }
    }

    async function linkPasswordToCurrentUser(password) {
      await ready();
      const user = auth.currentUser;
      if (!user || !user.email) throw new Error("This account does not have an email address.");
      const value = String(password || "");
      if (value.length < 10) throw new Error("Choose a password with at least 10 characters.");
      const credential = firebaseSDK.auth.EmailAuthProvider.credential(user.email, value);
      const result = await user.linkWithCredential(credential);
      return result.user;
    }

    async function sendPasswordReset(email) {
      await ready();
      return auth.sendPasswordResetEmail(String(email || "").trim());
    }

    async function sendEmailVerification() {
      await ready();
      if (!auth.currentUser) throw new Error("Sign in before requesting email verification.");
      if (auth.currentUser.emailVerified) return false;
      await auth.currentUser.sendEmailVerification();
      return true;
    }

    async function refreshCurrentUser() {
      await ready();
      if (!auth.currentUser) return null;
      await auth.currentUser.reload();
      return auth.currentUser;
    }

    async function signOut() {
      await ready();
      return auth.signOut();
    }

    function onAuthStateChanged(callback) {
      return auth.onAuthStateChanged(callback);
    }

    async function getRedirectResult() {
      await ready();
      return auth.getRedirectResult();
    }

    window.FOODIEHUB_CLOUD = {
      available: true,
      ready,
      loadAccount,
      saveAccount,
      deleteAddress,
      signInWithEmail,
      registerWithEmail,
      signInWithGoogle,
      linkGoogleToCurrentUser,
      linkPasswordToCurrentUser,
      sendPasswordReset,
      sendEmailVerification,
      refreshCurrentUser,
      signOut,
      onAuthStateChanged,
      getRedirectResult
    };
  } catch (error) {
    console.error("FoodieHub Firebase initialization failed:", error);
    window.FOODIEHUB_CLOUD = {
      available: false,
      error: error && error.message ? error.message : "Firebase could not be initialized."
    };
  }
})();

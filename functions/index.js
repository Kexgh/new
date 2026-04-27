const { onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const crypto = require("crypto");

admin.initializeApp();

const db = admin.firestore();

function hashFlag(flag) {
  return crypto
    .createHash("sha256")
    .update(flag.trim().toLowerCase())
    .digest("hex");
}

exports.registerUsername = onCall(async (request) => {
  const uid = request.auth?.uid;

  if (!uid) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }

  const userRef = db.collection("users").doc(uid);
  const existingUser = await userRef.get();

  if (existingUser.exists) {
    const data = existingUser.data();

    if (data.username) {
      return {
        success: false,
        message: `You are already registered as ${data.username}.`,
      };
    }
  }

  const username = request.data.username;

  if (!username || typeof username !== "string") {
    throw new HttpsError("invalid-argument", "Username is required.");
  }

  const cleanUsername = username.trim().toLowerCase();

  if (!/^[a-z0-9_]{3,16}$/.test(cleanUsername)) {
    throw new HttpsError(
      "invalid-argument",
      "Username must be 3-16 characters: lowercase letters, numbers, or underscores."
    );
  }

  const taken = await db
    .collection("users")
    .where("username", "==", cleanUsername)
    .limit(1)
    .get();

  if (!taken.empty) {
    throw new HttpsError("already-exists", "Username already taken.");
  }

  await userRef.set(
    {
      username: cleanUsername,
      score: 0,
      solved: {},
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return {
    success: true,
    message: `Registered as ${cleanUsername}.`,
  };
});

exports.submitFlag = onCall(async (request) => {
  const uid = request.auth?.uid;

  if (!uid) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }

  const submittedFlag = request.data.flag;

  if (!submittedFlag || typeof submittedFlag !== "string") {
    throw new HttpsError("invalid-argument", "Flag is required.");
  }

  const submittedHash = hashFlag(submittedFlag);

  const flagSnapshot = await db
    .collection("flags")
    .where("active", "==", true)
    .where("hash", "==", submittedHash)
    .limit(1)
    .get();

  if (flagSnapshot.empty) {
    return {
      correct: false,
      message: "Invalid flag.",
    };
  }

  const flagDoc = flagSnapshot.docs[0];
  const flagId = flagDoc.id;
  const flagData = flagDoc.data();

  const userRef = db.collection("users").doc(uid);
  const userDoc = await userRef.get();

  if (!userDoc.exists) {
    throw new HttpsError("failed-precondition", "Register a username first.");
  }

  const userData = userDoc.data();

  if (userData.solved && userData.solved[flagId]) {
    return {
      correct: true,
      duplicate: true,
      message: "You already solved this flag.",
    };
  }

  await db.runTransaction(async (transaction) => {
    const freshUserDoc = await transaction.get(userRef);
    const freshUserData = freshUserDoc.data();

    if (freshUserData.solved && freshUserData.solved[flagId]) {
      return;
    }

    transaction.update(userRef, {
      score: admin.firestore.FieldValue.increment(flagData.points),
      [`solved.${flagId}`]: true,
    });

    const submissionRef = db.collection("submissions").doc();

    transaction.set(submissionRef, {
      userId: uid,
      username: freshUserData.username,
      flagId,
      points: flagData.points,
      correct: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  return {
    correct: true,
    duplicate: false,
    points: flagData.points,
    flagName: flagData.name,
    message: `Correct flag: ${flagData.name}. +${flagData.points} points.`,
  };
});
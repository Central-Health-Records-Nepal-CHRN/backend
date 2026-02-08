import { auth } from "../lib/auth.js";

export const requireAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    console.log('requireAuth - Authorization header:', authHeader); 

    const session = await auth.api.getSession({
      headers: req.headers
    })

    console.debug('requireAuth - session fetched:', !!session && !!session.user);

    if (!session || !session.user) {
      return res.status(401).json({ message: "Invalid session" });
    }

    // Attach user info to request
    req.user = {
      userId: session.user.id,
      email: session.user.email,
    };

    next();
  } catch (err) {
    console.error("Auth error:", err);
    res.status(401).json({ message: "Unauthorized" });
  }
};

const crypto = require("crypto");
const bcrypt = require("bcryptjs");

// Generates a 6-digit numeric OTP
const generateOtp = () => {
  return crypto.randomInt(100000, 999999).toString();
};

const hashOtp = async (otp) => {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(otp, salt);
};

const compareOtp = async (plainOtp, hashedOtp) => {
  if (!hashedOtp) return false;
  return bcrypt.compare(plainOtp, hashedOtp);
};

const getOtpExpiry = () => {
  const minutes = Number(process.env.OTP_EXPIRES_MINUTES) || 10;
  return new Date(Date.now() + minutes * 60 * 1000);
};

module.exports = { generateOtp, hashOtp, compareOtp, getOtpExpiry };

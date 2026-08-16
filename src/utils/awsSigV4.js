const crypto = require("crypto");

// Signs a simple GET request (no body, no query params) using AWS Signature
// Version 4. Good enough to hit STS "GetCallerIdentity" as a lightweight,
// service-agnostic way to check "are these AWS access keys valid" without
// depending on the full aws-sdk package.
function sha256Hex(data) {
  return crypto.createHash("sha256").update(data, "utf8").digest("hex");
}

function hmac(key, data) {
  return crypto.createHmac("sha256", key).update(data, "utf8").digest();
}

function getSignatureKey(secretKey, dateStamp, region, service) {
  const kDate = hmac(`AWS4${secretKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, "aws4_request");
}

/**
 * Builds signed headers for a GET request against an AWS service endpoint.
 * @param {object} opts
 * @param {string} opts.accessKeyId
 * @param {string} opts.secretAccessKey
 * @param {string} opts.region
 * @param {string} opts.service - e.g. "sts", "sns"
 * @param {string} opts.host - e.g. "sts.amazonaws.com"
 * @param {string} opts.path - e.g. "/"
 * @param {Record<string,string>} [opts.query]
 */
function signGetRequest({ accessKeyId, secretAccessKey, region, service, host, path = "/", query = {} }) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);

  const canonicalQuery = Object.keys(query)
    .sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(query[k])}`)
    .join("&");

  const canonicalHeaders = `host:${host}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-date";
  const payloadHash = sha256Hex("");

  const canonicalRequest = [path, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const canonicalRequestFull = `GET\n${canonicalRequest}`;

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequestFull),
  ].join("\n");

  const signingKey = getSignatureKey(secretAccessKey, dateStamp, region, service);
  const signature = crypto.createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");

  const authorizationHeader = `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    url: `https://${host}${path}${canonicalQuery ? `?${canonicalQuery}` : ""}`,
    headers: {
      Authorization: authorizationHeader,
      "X-Amz-Date": amzDate,
      Host: host,
    },
  };
}

module.exports = { signGetRequest };
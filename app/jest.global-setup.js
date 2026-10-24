// Run tests in a non-IST, non-UTC zone so Asia/Kolkata handling is really exercised.
module.exports = async () => {
  process.env.TZ = "America/Los_Angeles";
};

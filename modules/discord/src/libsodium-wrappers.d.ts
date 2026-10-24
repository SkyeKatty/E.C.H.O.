declare module "libsodium-wrappers" {
  const sodium: { ready: Promise<void> };
  export default sodium;
}

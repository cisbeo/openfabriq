# frozen_string_literal: true

# Formula for the openfabriq/homebrew-tap repository: brew install openfabriq/tap/openfabriq.
# On each release, after npm publish, set url and sha256 from the published tarball:
#   curl -sL https://registry.npmjs.org/openfabriq/-/openfabriq-<version>.tgz | shasum -a 256
class Openfabriq < Formula
  desc "Run a software factory described in your repository, with your Claude Code"
  homepage "https://github.com/openfabriq/openfabriq"
  url "https://registry.npmjs.org/openfabriq/-/openfabriq-0.1.0.tgz"
  sha256 "164aaaecc79f79abe697ade6cf1996616a0ad0cda6b73039caa75e445aa0ce55"
  license "Apache-2.0"

  depends_on "gh"
  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink libexec.glob("bin/*")
  end

  def caveats
    <<~EOS
      openfabriq runs your Claude Code, which Homebrew does not install as a dependency:
        brew install --cask claude-code
      Then log in once:
        claude auth login && gh auth login
      The first openfabriq init, plan, apply, start or run says what is still missing.
    EOS
  end

  test do
    assert_match "Usage: openfabriq", shell_output(bin/"openfabriq")
    system "git", "init", "--quiet"
    system bin/"openfabriq", "init", "--example", "01-quickstart"
    assert_match "is valid", shell_output("#{bin}/openfabriq validate")
  end
end

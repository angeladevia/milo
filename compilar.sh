set -eu
mkdir -p public
cat recursos-*.tar.gz.part | tar -xzf - -C public
cp ./*.html ./*.js ./*.css public/

#!/bin/bash
# Prepara um realm de teste do importador num Keycloak 16 (imagem quay.io/keycloak/keycloak:16.1.1).
# Roda DENTRO do container e usa o admin definido em KEYCLOAK_USER/KEYCLOAK_PASSWORD:
#
#   docker exec -i <container> bash -s < test/e2e/keycloak16-setup.sh
#   docker exec -i -e RESET=1 <container> bash -s < test/e2e/keycloak16-setup.sh   # recria o realm
#
# Variáveis opcionais: REALM (importador-teste), CLIENT_ID (importador-usuarios), RESET (0).
set -euo pipefail

KCADM=/opt/jboss/keycloak/bin/kcadm.sh
REALM=${REALM:-importador-teste}
CLIENT_ID=${CLIENT_ID:-importador-usuarios}
CFG=/tmp/kcadm-importador.config

kc() { "$KCADM" "$@" --config "$CFG"; }

"$KCADM" config credentials --config "$CFG" --server http://localhost:8080/auth \
  --realm master --user "$KEYCLOAK_USER" --password "$KEYCLOAK_PASSWORD"

if kc get "realms/$REALM" >/dev/null 2>&1; then
  if [ "${RESET:-0}" != 1 ]; then
    echo "O realm $REALM já existe. Use RESET=1 para apagá-lo e recriá-lo." >&2
    exit 1
  fi
  kc delete "realms/$REALM"
fi

kc create realms -s realm="$REALM" -s enabled=true \
  -s duplicateEmailsAllowed=true -s loginWithEmailAllowed=false -s resetPasswordAllowed=true
kc update "authentication/required-actions/UPDATE_PROFILE" -r "$REALM" -s enabled=true

declare -A GROUP_ID
group() {
  local path=$1 name=${1##*/} parent=${1%/*}
  if [ -z "$parent" ]; then
    GROUP_ID[$path]=$(kc create groups -r "$REALM" -s name="$name" -i)
  else
    GROUP_ID[$path]=$(kc create "groups/${GROUP_ID[$parent]}/children" -r "$REALM" -s name="$name" -i)
  fi
}
for path in \
  /APP.PORTAL \
  /APP.PORTAL/ROLE_PORTAL_USER \
  /APP.PORTAL/ROLE_PORTAL_ADMIN \
  /APP.PORTAL/ROLE_PORTAL_ADMIN/ROLE_PORTAL_AUDITOR \
  /APP.FINANCEIRO \
  /APP.FINANCEIRO/ROLE_FIN_CONSULTA \
  /APP.FINANCEIRO/ROLE_FIN_APROVADOR \
  /Colaboradores; do
  group "$path"
done

client_uuid=$(kc create clients -r "$REALM" -s clientId="$CLIENT_ID" -s enabled=true -s publicClient=false \
  -s serviceAccountsEnabled=true -s standardFlowEnabled=false -s directAccessGrantsEnabled=false \
  -s clientAuthenticatorType=client-secret -i)
kc add-roles -r "$REALM" --uusername "service-account-$CLIENT_ID" --cclientid realm-management \
  --rolename manage-users --rolename view-users --rolename query-groups

# Usuários pré-existentes: sem grupo, com parte dos grupos e com todos os grupos (e outra ação obrigatória).
user() {
  local username=$1 first=$2 last=$3 actions=$4; shift 4
  local id
  id=$(kc create users -r "$REALM" -s username="$username" -s email="$username@exemplo.com" \
    -s firstName="$first" -s lastName="$last" -s enabled=true -s "requiredActions=$actions" -i)
  for path in "$@"; do
    kc update "users/$id/groups/${GROUP_ID[$path]}" -r "$REALM" -s realm="$REALM" -s userId="$id" \
      -s groupId="${GROUP_ID[$path]}" -n
  done
}
user bsilva Bruno Silva '[]'
user csouza Carla Souza '[]' /APP.PORTAL/ROLE_PORTAL_USER
user dlima Daniel Lima '["CONFIGURE_TOTP"]' /APP.PORTAL/ROLE_PORTAL_USER /APP.PORTAL/ROLE_PORTAL_ADMIN

kc create "clients/$client_uuid/client-secret" -r "$REALM"
secret=$(kc get "clients/$client_uuid/client-secret" -r "$REALM" --fields value --format csv --noquotes)
echo
echo "Realm $REALM pronto. Configure o backend/.env com:"
echo "KEYCLOAK_BASE_URL=http://localhost:<porta publicada do container>/auth"
echo "KEYCLOAK_REALM=$REALM"
echo "KEYCLOAK_CLIENT_ID=$CLIENT_ID"
echo "KEYCLOAK_CLIENT_SECRET=$secret"

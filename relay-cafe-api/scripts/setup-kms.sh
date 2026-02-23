#!/usr/bin/env bash
# KMS key setup for relay.cafe
#
# Key retention requirement:
#   key_retention >= MESSAGE_TTL + rotation_period + safety_buffer
#   24h + 24h + 2h = 50h minimum
#
# GCP enforces: destroy-scheduled-duration >= 24h (default 30 days).
# We set it to 72h (3 days) — comfortably above the 50h minimum while
# still cleaning up old versions in a reasonable window.
#
# Rotation period: 24h — one primary version per day.
#
# IMPORTANT: Once a CryptoKey is created, destroy-scheduled-duration
# CANNOT be reduced. It can only be increased. Choose carefully.

set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:?Set GCP_PROJECT_ID}"
LOCATION="${GCP_KMS_LOCATION:?Set GCP_KMS_LOCATION}"
KEY_RING="${GCP_KMS_KEY_RING:?Set GCP_KMS_KEY_RING}"
KEY_NAME="${GCP_KMS_KEY_NAME:?Set GCP_KMS_KEY_NAME}"

ROTATION_PERIOD="86400s"           # 24 hours
DESTROY_SCHEDULED_DURATION="259200s"  # 72 hours (50h minimum, 72h for safety)

echo "=== relay.cafe KMS Key Setup ==="
echo "Project:   $PROJECT_ID"
echo "Location:  $LOCATION"
echo "Key Ring:  $KEY_RING"
echo "Key:       $KEY_NAME"
echo "Rotation:  24h"
echo "Destroy delay: 72h (minimum required: 50h)"
echo ""

# Create key ring (idempotent — errors if exists, that's fine)
gcloud kms keyrings create "$KEY_RING" \
  --project="$PROJECT_ID" \
  --location="$LOCATION" 2>/dev/null || true

# Create or update key with correct rotation and destruction schedule
if gcloud kms keys describe "$KEY_NAME" \
  --project="$PROJECT_ID" \
  --location="$LOCATION" \
  --keyring="$KEY_RING" &>/dev/null; then

  echo "Key exists. Updating rotation and destruction schedule..."
  gcloud kms keys update "$KEY_NAME" \
    --project="$PROJECT_ID" \
    --location="$LOCATION" \
    --keyring="$KEY_RING" \
    --rotation-period="$ROTATION_PERIOD" \
    --next-rotation-time="$(date -u -v+24H '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -d '+24 hours' '+%Y-%m-%dT%H:%M:%SZ')" \
    --destroy-scheduled-duration="$DESTROY_SCHEDULED_DURATION"
else
  echo "Creating key..."
  gcloud kms keys create "$KEY_NAME" \
    --project="$PROJECT_ID" \
    --location="$LOCATION" \
    --keyring="$KEY_RING" \
    --purpose="encryption" \
    --rotation-period="$ROTATION_PERIOD" \
    --next-rotation-time="$(date -u -v+24H '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -d '+24 hours' '+%Y-%m-%dT%H:%M:%SZ')" \
    --destroy-scheduled-duration="$DESTROY_SCHEDULED_DURATION"
fi

echo ""
echo "Done. Verify with:"
echo "  gcloud kms keys describe $KEY_NAME --project=$PROJECT_ID --location=$LOCATION --keyring=$KEY_RING"

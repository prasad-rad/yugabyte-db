package com.yugabyte.yw.commissioner.tasks.params;

import java.util.UUID;

import com.yugabyte.yw.forms.UniverseTaskParams;
import com.yugabyte.yw.models.AccessKey;

public class RotateAccessKeyParams extends UniverseTaskParams implements IProviderTaskParams {
  public UUID customerUUID;
  public UUID providerUUID;
  public AccessKey newAccessKey;

  public RotateAccessKeyParams(
      UUID customerUUID, UUID providerUUID, UUID universeUUID, AccessKey newAccessKey) {
    this.customerUUID = customerUUID;
    this.providerUUID = providerUUID;
    this.newAccessKey = newAccessKey;
    setUniverseUUID(universeUUID);
  }

  @Override
  public UUID getProviderUUID() {
    return providerUUID;
  }
}

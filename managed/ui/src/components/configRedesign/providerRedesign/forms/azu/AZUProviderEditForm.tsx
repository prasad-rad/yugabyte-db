import React, { useState } from 'react';
import { FormProvider, SubmitHandler, useForm } from 'react-hook-form';
import { Box, CircularProgress, FormHelperText, Typography } from '@material-ui/core';
import { yupResolver } from '@hookform/resolvers/yup';
import { array, mixed, object, string } from 'yup';
import { toast } from 'react-toastify';

import {
  RadioGroupOrientation,
  YBInput,
  YBInputField,
  YBRadioGroupField,
  YBToggleField
} from '../../../../../redesign/components';
import { YBButton } from '../../../../common/forms/fields';
import {
  CloudVendorRegionField,
  ConfigureRegionModal
} from '../configureRegion/ConfigureRegionModal';
import { NTPConfigField } from '../../components/NTPConfigField';
import { RegionList } from '../../components/RegionList';
import {
  KeyPairManagement,
  KEY_PAIR_MANAGEMENT_OPTIONS,
  NTPSetupType,
  ProviderCode,
  VPCSetupType
} from '../../constants';
import { FieldGroup } from '../components/FieldGroup';
import { FormContainer } from '../components/FormContainer';
import { FormField } from '../components/FormField';
import { FieldLabel } from '../components/FieldLabel';
import { getNtpSetupType } from '../../utils';
import { RegionOperation } from '../configureRegion/constants';
import {
  addItem,
  deleteItem,
  editItem,
  generateLowerCaseAlphanumericId,
  readFileAsText
} from '../utils';
import { EditProvider } from '../ProviderEditView';
import { DeleteRegionModal } from '../../components/DeleteRegionModal';
import { YBDropZoneField } from '../../components/YBDropZone/YBDropZoneField';
import { VersionWarningBanner } from '../components/VersionWarningBanner';
import { ACCEPTABLE_CHARS } from '../../../../config/constants';
import { NTP_SERVER_REGEX } from '../constants';

import { AZUAvailabilityZoneMutation, AZUProvider, AZURegionMutation } from '../../types';

interface AZUProviderEditFormProps {
  editProvider: EditProvider;
  isProviderInUse: boolean;
  providerConfig: AZUProvider;
}

export interface AZUProviderEditFormFieldValues {
  azuClientId: string;
  azuClientSecret: string;
  azuHostedZoneId: string;
  azuRG: string;
  azuSubscriptionId: string;
  azuTenantId: string;
  dbNodePublicInternetAccess: boolean;
  editSSHKeypair: boolean;
  ntpServers: string[];
  ntpSetupType: NTPSetupType;
  providerName: string;
  regions: CloudVendorRegionField[];
  sshKeypairManagement: KeyPairManagement;
  sshKeypairName: string;
  sshPort: number;
  sshPrivateKeyContent: File;
  sshUser: string;
  version: number;
}

const VALIDATION_SCHEMA = object().shape({
  providerName: string()
    .required('Provider Name is required.')
    .matches(
      ACCEPTABLE_CHARS,
      'Provider name cannot contain special characters other than "-", and "_"'
    ),
  azuClientId: string().required('Azure Client ID is required.'),
  azuClientSecret: string().required('Azure Client Secret is required.'),
  azuRG: string().required('Azure Resource Group is required.'),
  azuSubscriptionId: string().required('Azure Subscription ID is required.'),
  azuTenantId: string().required('Azure Tenant ID is required.'),
  sshKeypairManagement: mixed().when('editSSHKeypair', {
    is: true,
    then: mixed().oneOf(
      [KeyPairManagement.SELF_MANAGED, KeyPairManagement.YBA_MANAGED],
      'SSH Keypair management choice is required.'
    )
  }),
  sshPrivateKeyContent: mixed().when(['editSSHKeypair', 'sshKeypairManagement'], {
    is: (editSSHKeypair, sshKeypairManagement) =>
      editSSHKeypair && sshKeypairManagement === KeyPairManagement.SELF_MANAGED,
    then: mixed().required('SSH private key is required.')
  }),
  hostedZoneId: string().when('enableHostedZone', {
    is: true,
    then: string().required('Route 53 zone id is required.')
  }),
  ntpServers: array().when('ntpSetupType', {
    is: NTPSetupType.SPECIFIED,
    then: array().of(
      string().matches(
        NTP_SERVER_REGEX,
        (testContext) =>
          `NTP servers must be provided in IPv4, IPv6, or hostname format. '${testContext.originalValue}' is not valid.`
      )
    )
  }),
  regions: array().min(1, 'Provider configurations must contain at least one region.')
});

export const AZUProviderEditForm = ({
  editProvider,
  isProviderInUse,
  providerConfig
}: AZUProviderEditFormProps) => {
  const [isRegionFormModalOpen, setIsRegionFormModalOpen] = useState<boolean>(false);
  const [isDeleteRegionModalOpen, setIsDeleteRegionModalOpen] = useState<boolean>(false);
  const [regionSelection, setRegionSelection] = useState<CloudVendorRegionField>();
  const [regionOperation, setRegionOperation] = useState<RegionOperation>(RegionOperation.ADD);

  const defaultValues = constructDefaultFormValues(providerConfig);
  const formMethods = useForm<AZUProviderEditFormFieldValues>({
    defaultValues: defaultValues,
    resolver: yupResolver(VALIDATION_SCHEMA)
  });

  const showAddRegionFormModal = () => {
    setRegionSelection(undefined);
    setRegionOperation(RegionOperation.ADD);
    setIsRegionFormModalOpen(true);
  };
  const showEditRegionFormModal = () => {
    setRegionOperation(RegionOperation.EDIT);
    setIsRegionFormModalOpen(true);
  };
  const showDeleteRegionModal = () => {
    setIsDeleteRegionModalOpen(true);
  };
  const hideDeleteRegionModal = () => {
    setIsDeleteRegionModalOpen(false);
  };
  const hideRegionFormModal = () => {
    setIsRegionFormModalOpen(false);
  };

  const onFormReset = () => formMethods.reset();
  const onFormSubmit: SubmitHandler<AZUProviderEditFormFieldValues> = async (formValues) => {
    if (formValues.ntpSetupType === NTPSetupType.SPECIFIED && !formValues.ntpServers.length) {
      formMethods.setError('ntpServers', {
        type: 'min',
        message: 'Please specify at least one NTP server.'
      });
      return;
    }

    try {
      const providerPayload = await constructProviderPayload(formValues);
      try {
        await editProvider(providerPayload);
      } catch (_) {
        // Handled with `mutateOptions.onError`
      }
    } catch (error) {
      toast.error(error);
    }
  };

  const regions = formMethods.watch('regions', defaultValues.regions);
  const setRegions = (regions: CloudVendorRegionField[]) =>
    formMethods.setValue('regions', regions);
  const onRegionFormSubmit = (currentRegion: CloudVendorRegionField) => {
    regionOperation === RegionOperation.ADD
      ? addItem(currentRegion, regions, setRegions)
      : editItem(currentRegion, regions, setRegions);
  };
  const onDeleteRegionSubmit = (currentRegion: CloudVendorRegionField) =>
    deleteItem(currentRegion, regions, setRegions);

  const currentProviderVersion = formMethods.watch('version', defaultValues.version);
  const keyPairManagement = formMethods.watch('sshKeypairManagement');
  const editSSHKeypair = formMethods.watch('editSSHKeypair', defaultValues.editSSHKeypair);
  const isFormDisabled =
    isProviderInUse || formMethods.formState.isValidating || formMethods.formState.isSubmitting;
  return (
    <Box display="flex" justifyContent="center">
      <FormProvider {...formMethods}>
        <FormContainer name="azuProviderForm" onSubmit={formMethods.handleSubmit(onFormSubmit)}>
          {currentProviderVersion < providerConfig.version && (
            <VersionWarningBanner onReset={onFormReset} />
          )}
          <Typography variant="h3">Manage Azure Provider Configuration</Typography>
          <FormField providerNameField={true}>
            <FieldLabel>Provider Name</FieldLabel>
            <YBInputField
              control={formMethods.control}
              name="providerName"
              disabled={isFormDisabled}
              fullWidth
            />
          </FormField>
          <Box width="100%" display="flex" flexDirection="column" gridGap="32px">
            <FieldGroup heading="Cloud Info">
              <FormField>
                <FieldLabel>Client ID</FieldLabel>
                <YBInputField
                  control={formMethods.control}
                  name="azuClientId"
                  disabled={isFormDisabled}
                  fullWidth
                />
              </FormField>
              <FormField>
                <FieldLabel>Client Secret</FieldLabel>
                <YBInputField
                  control={formMethods.control}
                  name="azuClientSecret"
                  disabled={isFormDisabled}
                  fullWidth
                />
              </FormField>
              <FormField>
                <FieldLabel>Resource Group</FieldLabel>
                <YBInputField
                  control={formMethods.control}
                  name="azuRG"
                  disabled={isFormDisabled}
                  fullWidth
                />
              </FormField>
              <FormField>
                <FieldLabel>Subscription ID</FieldLabel>
                <YBInputField
                  control={formMethods.control}
                  name="azuSubscriptionId"
                  disabled={isFormDisabled}
                  fullWidth
                />
              </FormField>
              <FormField>
                <FieldLabel>Tenant ID</FieldLabel>
                <YBInputField
                  control={formMethods.control}
                  name="azuTenantId"
                  disabled={isFormDisabled}
                  fullWidth
                />
              </FormField>
              <FormField>
                <FieldLabel>Private DNS Zone (Optional)</FieldLabel>
                <YBInputField
                  control={formMethods.control}
                  name="azuHostedZoneId"
                  disabled={isFormDisabled}
                  fullWidth
                />
              </FormField>
            </FieldGroup>
            <FieldGroup
              heading="Regions"
              headerAccessories={
                <YBButton
                  btnIcon="fa fa-plus"
                  btnText="Add Region"
                  btnClass="btn btn-default"
                  btnType="button"
                  onClick={showAddRegionFormModal}
                  disabled={isFormDisabled}
                />
              }
            >
              <RegionList
                providerCode={ProviderCode.AZU}
                regions={regions}
                setRegionSelection={setRegionSelection}
                showAddRegionFormModal={showAddRegionFormModal}
                showEditRegionFormModal={showEditRegionFormModal}
                showDeleteRegionModal={showDeleteRegionModal}
                disabled={isFormDisabled}
                isError={!!formMethods.formState.errors.regions}
              />
              {formMethods.formState.errors.regions?.message && (
                <FormHelperText error={true}>
                  {formMethods.formState.errors.regions?.message}
                </FormHelperText>
              )}
            </FieldGroup>
            <FieldGroup heading="SSH Key Pairs">
              <FormField>
                <FieldLabel>SSH User</FieldLabel>
                <YBInputField
                  control={formMethods.control}
                  name="sshUser"
                  disabled={isFormDisabled}
                  fullWidth
                />
              </FormField>
              <FormField>
                <FieldLabel>SSH Port</FieldLabel>
                <YBInputField
                  control={formMethods.control}
                  name="sshPort"
                  type="number"
                  inputProps={{ min: 0, max: 65535 }}
                  disabled={isFormDisabled}
                  fullWidth
                />
              </FormField>
              <FormField>
                <FieldLabel>Current SSH Keypair Name</FieldLabel>
                <YBInput
                  value={providerConfig.allAccessKeys[0].keyInfo.keyPairName}
                  disabled={true}
                  fullWidth
                />
              </FormField>
              <FormField>
                <FieldLabel>Current SSH Private Key</FieldLabel>
                <YBInput
                  value={providerConfig.allAccessKeys[0].keyInfo.privateKey}
                  disabled={true}
                  fullWidth
                />
              </FormField>
              <FormField>
                <FieldLabel>Change SSH Keypair</FieldLabel>
                <YBToggleField
                  name="editSSHKeypair"
                  control={formMethods.control}
                  disabled={isFormDisabled}
                />
              </FormField>
              {editSSHKeypair && (
                <>
                  <FormField>
                    <FieldLabel>Key Pair Management</FieldLabel>
                    <YBRadioGroupField
                      name="sshKeypairManagement"
                      control={formMethods.control}
                      options={KEY_PAIR_MANAGEMENT_OPTIONS}
                      orientation={RadioGroupOrientation.HORIZONTAL}
                    />
                  </FormField>
                  {keyPairManagement === KeyPairManagement.SELF_MANAGED && (
                    <>
                      <FormField>
                        <FieldLabel>SSH Keypair Name</FieldLabel>
                        <YBInputField
                          control={formMethods.control}
                          name="sshKeypairName"
                          disabled={isFormDisabled}
                          fullWidth
                        />
                      </FormField>
                      <FormField>
                        <FieldLabel>SSH Private Key Content</FieldLabel>
                        <YBDropZoneField
                          name="sshPrivateKeyContent"
                          control={formMethods.control}
                          actionButtonText="Upload SSH Key PEM File"
                          multipleFiles={false}
                          showHelpText={false}
                          disabled={isFormDisabled}
                        />
                      </FormField>
                    </>
                  )}
                </>
              )}
            </FieldGroup>
            <FieldGroup heading="Advanced">
              <FormField>
                <FieldLabel>DB Nodes have public internet access?</FieldLabel>
                <YBToggleField
                  name="dbNodePublicInternetAccess"
                  control={formMethods.control}
                  disabled={isFormDisabled}
                />
              </FormField>
              <FormField>
                <FieldLabel>NTP Setup</FieldLabel>
                <NTPConfigField isDisabled={isFormDisabled} providerCode={ProviderCode.AZU} />
              </FormField>
            </FieldGroup>
            {(formMethods.formState.isValidating || formMethods.formState.isSubmitting) && (
              <Box display="flex" gridGap="5px" marginLeft="auto">
                <CircularProgress size={16} color="primary" thickness={5} />
              </Box>
            )}
          </Box>
          <Box marginTop="16px">
            <YBButton
              btnText="Apply Changes"
              btnClass="btn btn-default save-btn"
              btnType="submit"
              disabled={isFormDisabled}
              data-testid="AZUProviderCreateForm-SubmitButton"
            />
            <YBButton
              btnText="Clear Changes"
              btnClass="btn btn-default"
              onClick={onFormReset}
              disabled={isFormDisabled}
              data-testid="AZUProviderCreateForm-BackButton"
            />
          </Box>
        </FormContainer>
      </FormProvider>
      {/* Modals */}
      {isRegionFormModalOpen && (
        <ConfigureRegionModal
          configuredRegions={regions}
          onClose={hideRegionFormModal}
          onRegionSubmit={onRegionFormSubmit}
          open={isRegionFormModalOpen}
          providerCode={ProviderCode.AZU}
          regionOperation={regionOperation}
          regionSelection={regionSelection}
          vpcSetupType={VPCSetupType.EXISTING}
        />
      )}
      <DeleteRegionModal
        region={regionSelection}
        onClose={hideDeleteRegionModal}
        open={isDeleteRegionModalOpen}
        deleteRegion={onDeleteRegionSubmit}
      />
    </Box>
  );
};

const constructDefaultFormValues = (
  providerConfig: AZUProvider
): Partial<AZUProviderEditFormFieldValues> => ({
  azuClientId: providerConfig.details.cloudInfo.azu.azuClientId,
  azuClientSecret: providerConfig.details.cloudInfo.azu.azuClientSecret,
  azuHostedZoneId: providerConfig.details.cloudInfo.azu.azuHostedZoneId,
  azuRG: providerConfig.details.cloudInfo.azu.azuRG,
  azuSubscriptionId: providerConfig.details.cloudInfo.azu.azuSubscriptionId,
  azuTenantId: providerConfig.details.cloudInfo.azu.azuTenantId,
  dbNodePublicInternetAccess: !providerConfig.details.airGapInstall,
  editSSHKeypair: false,
  ntpServers: providerConfig.details.ntpServers,
  ntpSetupType: getNtpSetupType(providerConfig),
  providerName: providerConfig.name,
  regions: providerConfig.regions.map((region) => ({
    fieldId: generateLowerCaseAlphanumericId(),
    code: region.code,
    vnet: region.details.cloudInfo.azu.vnet,
    securityGroupId: region.details.cloudInfo.azu.securityGroupId,
    ybImage: region.details.cloudInfo.azu.ybImage ?? '',
    zones: region.zones
  })),
  sshKeypairManagement: providerConfig.allAccessKeys?.[0]?.keyInfo.managementState,
  sshPort: providerConfig.details.sshPort,
  sshUser: providerConfig.details.sshUser,
  version: providerConfig.version
});

const constructProviderPayload = async (formValues: AZUProviderEditFormFieldValues) => ({
  code: ProviderCode.AZU,
  name: formValues.providerName,
  ...(formValues.editSSHKeypair &&
    formValues.sshKeypairManagement === KeyPairManagement.SELF_MANAGED && {
      ...(formValues.sshKeypairName && { keyPairName: formValues.sshKeypairName }),
      ...(formValues.sshPrivateKeyContent && {
        sshPrivateKeyContent: (await readFileAsText(formValues.sshPrivateKeyContent)) ?? ''
      })
    }),
  details: {
    airGapInstall: !formValues.dbNodePublicInternetAccess,
    cloudInfo: {
      [ProviderCode.AZU]: {
        azuClientId: formValues.azuClientId,
        azuClientSecret: formValues.azuClientSecret,
        azuHostedZoneId: formValues.azuHostedZoneId,
        azuRG: formValues.azuRG,
        azuSubscriptionId: formValues.azuSubscriptionId,
        azuTenantId: formValues.azuTenantId
      }
    },
    ntpServers: formValues.ntpServers,
    setUpChrony: formValues.ntpSetupType !== NTPSetupType.NO_NTP,
    sshPort: formValues.sshPort,
    sshUser: formValues.sshUser
  },
  regions: formValues.regions.map<AZURegionMutation>((regionFormValues) => ({
    code: regionFormValues.code,
    details: {
      cloudInfo: {
        [ProviderCode.AZU]: {
          securityGroupId: regionFormValues.securityGroupId,
          vnet: regionFormValues.vnet,
          ybImage: regionFormValues.ybImage
        }
      }
    },
    zones: regionFormValues.zones?.map<AZUAvailabilityZoneMutation>((azFormValues) => ({
      code: azFormValues.code,
      name: azFormValues.code,
      subnet: azFormValues.subnet
    }))
  })),
  version: formValues.version
});

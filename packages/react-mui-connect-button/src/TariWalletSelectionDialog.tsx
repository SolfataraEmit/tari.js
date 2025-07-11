import { Box, Dialog, Divider, Stack, IconButton, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import Grid from "@mui/material/Grid";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import { TariSigner } from "@tari-project/tari-signer";
import { WalletDaemonTariSigner, WalletDaemonFetchParameters } from "@tari-project/wallet-daemon-signer";
import { ReactElement } from "react";
import { WalletConnectTariSigner } from "@tari-project/wallet-connect-signer";
import TariLogo from "./TariLogo";
import WalletConnectLogo from "./WalletConnectLogo";


export interface WalletSelectionProps {
  open: boolean;
  walletConnectProjectId?: string,
  onConnected?: (signer: TariSigner) => void;
  walletDaemonParams?: WalletDaemonFetchParameters;
  onClose: () => void;
}

export function TariWalletSelectionDialog(props: WalletSelectionProps): ReactElement {
  const { onClose, open, onConnected, walletConnectProjectId, walletDaemonParams } = props;

  const handleClose = onClose;

  const onWalletDaemonClick = async () => {
    if (!walletDaemonParams) {
      throw new Error("Wallet Daemon parameters were not provided.");
    }
    const walletDaemonSigner = await WalletDaemonTariSigner.buildFetchSigner(walletDaemonParams);
    onConnected?.(walletDaemonSigner);
    handleClose();
  };

  const onWalletConnectClick = async () => {
    if (!walletConnectProjectId) {
      throw new Error("WalletConnect project ID was not provided.");
    }
    const walletConnectSigner = new WalletConnectTariSigner(walletConnectProjectId);
    await walletConnectSigner.connect();
    onConnected?.(walletConnectSigner);
    handleClose();
  };

  return (
    <Dialog fullWidth={true} onClose={handleClose} open={open}>
      <Box sx={{ padding: 4, borderRadius: 4 }}>
        <Stack direction="row" justifyContent="space-between" spacing={2}>
          <Typography style={{ fontSize: 24 }}>Connect a wallet</Typography>
          <IconButton aria-label="copy" onClick={handleClose}>
            <CloseIcon style={{ fontSize: 24 }} />
          </IconButton>
        </Stack>
        <Divider sx={{ mt: 3, mb: 3 }} variant="middle" />
        <Grid container spacing={2} justifyContent="center">
          {walletDaemonParams && (
            <Grid size={{ xs: 4 }}>
              <WalletConnectionMethodCard logo={<TariLogo />} text="Tari Wallet Daemon"
                                          callback={onWalletDaemonClick}></WalletConnectionMethodCard>
            </Grid>
          )}
          <Grid size={{ xs: 4 }}>
            {walletConnectProjectId && <WalletConnectionMethodCard
              logo={<WalletConnectLogo />}
              text="WalletConnect"
              callback={onWalletConnectClick}
            />}
          </Grid>
        </Grid>
      </Box>
    </Dialog>
  );
}

function WalletConnectionMethodCard({ logo, text, callback }: {
  logo: React.ReactElement,
  text: string,
  callback: () => void
}) {
  return (
    <Card variant="outlined" elevation={0}
          sx={{ mty: 4, padding: 4, borderRadius: 4, width: "175px", height: "175px", cursor: "pointer" }}>
      <CardContent onClick={async () => {
        await callback();
      }}>
        <Stack direction="column" spacing={2} alignItems="center">
          <Box sx={{ textAlign: "center", width: "100%" }}>
            <div style={{ borderRadius: 8, width: "50px", height: "50px" }}>{logo}</div>
          </Box>
          <Typography textAlign="center">{text}</Typography>
        </Stack>
      </CardContent>
    </Card>
  );
};

import React from "react";
import { AppHeader, HelpMenu } from "@dynatrace/strato-components-preview/layouts";
import { Tooltip } from "@dynatrace/strato-components-preview/overlays";
import { Button } from "@dynatrace/strato-components/buttons";
import { SettingIcon } from "@dynatrace/strato-icons";

interface HeaderProps {
  onSettingsClick: () => void;
  onHelpClick: () => void;
}

export const Header = ({ onSettingsClick, onHelpClick }: HeaderProps) => {
  return (
    <AppHeader>
      <AppHeader.Menus>
        <Tooltip text="Settings">
          <Button onClick={onSettingsClick} aria-label="Settings">
            <Button.Prefix>
              <SettingIcon />
            </Button.Prefix>
          </Button>
        </Tooltip>
        <HelpMenu
          entries={{
            getStarted: {
              onSelect: onHelpClick,
            },
            about: "default",
          }}
        />
      </AppHeader.Menus>
    </AppHeader>
  );
};

import React from 'react';
import { UserButton } from '@clerk/clerk-react';

export const UserMenu: React.FC = () => {
  return (
    <div className="relative flex items-center">
      <UserButton 
        afterSignOutUrl="/" 
        appearance={{
          elements: {
            userButtonAvatarBox: "w-10 h-10",
          }
        }} 
      />
    </div>
  );
};

import { Avatar, AvatarImage, AvatarFallback } from './ui/avatar';

interface UserProfileChipProps {
  name: string;
  avatarUrl?: string;
  className?: string;
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

export function UserProfileChip({ name, avatarUrl, className = '' }: UserProfileChipProps) {
  return (
    <div
      className={`flex items-center gap-2 bg-gray-100 rounded-2xl px-4 py-2 ${className}`}
    >
      <Avatar className="w-9 h-9">
        {avatarUrl && <AvatarImage src={avatarUrl} alt={name} />}
        <AvatarFallback>{getInitials(name)}</AvatarFallback>
      </Avatar>
      <span className="font-bold text-gray-900 whitespace-nowrap">{name}</span>
    </div>
  );
}

export default UserProfileChip;

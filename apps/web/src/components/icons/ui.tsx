import type { IconProps } from "./types";

export function OcVideoIcon({
	className = "",
	size = 32,
}: IconProps) {
	return (
		<svg
			width={size}
			height={size}
			className={className}
			viewBox="0 0 29 24"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
		>
			<title>Video</title>
			<path
				d="M2.41667 11C2.41667 7.70017 2.41667 6.05025 3.65537 5.02513C4.89405 4 6.88771 4 10.875 4H12.0833C16.0706 4 18.0642 4 19.303 5.02513C20.5417 6.05025 20.5417 7.70017 20.5417 11V13C20.5417 16.2998 20.5417 17.9497 19.303 18.9749C18.0642 20 16.0706 20 12.0833 20H10.875C6.88771 20 4.89405 20 3.65537 18.9749C2.41667 17.9497 2.41667 16.2998 2.41667 13V11Z"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
			/>
			<path
				d="M20.5417 8.90585L20.6938 8.80196C23.2504 7.05623 24.5287 6.18336 25.556 6.60482C26.5833 7.02628 26.5833 8.42355 26.5833 11.2181V12.7819C26.5833 15.5765 26.5833 16.9737 25.556 17.3952C24.5287 17.8166 23.2504 16.9438 20.6938 15.198L20.5417 15.0941"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
			/>
		</svg>
	);
}

export function OcTextWidthIcon({
	className = "",
	size = 32,
}: IconProps) {
	return (
		<svg
			width={Math.round((size * 17) / 24)}
			height={size}
			className={className}
			viewBox="0 0 17 24"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
		>
			<title>Text width</title>
			<path
				d="M3.75 17.17C3.14316 17.7599 0.75 19.3297 0.75 20.17C0.75 21.0103 3.14316 22.5802 3.75 23.17M12.75 17.25C13.3568 17.8398 15.75 19.4097 15.75 20.25C15.75 21.0903 13.3568 22.6602 12.75 23.25M1.17285 20.1495L7.85685 20.1895L15.618 20.2295M8.25 0.75V15.75M8.25 0.75C9.6374 0.75 11.4195 0.78054 12.8384 0.92648C13.4385 0.98819 13.7386 1.01905 14.0041 1.1279C14.5566 1.35428 15.0018 1.85062 15.1694 2.4268C15.25 2.70381 15.25 3.01991 15.25 3.65214M8.25 0.75C6.8626 0.75 5.08047 0.78054 3.66161 0.92648C3.0615 0.98819 2.76144 1.01905 2.49586 1.1279C1.94344 1.35428 1.49816 1.85062 1.33057 2.4268C1.25 2.70381 1.25 3.01991 1.25 3.65214"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

export function OcTextHeightIcon({
	className = "",
	size = 32,
}: IconProps) {
	return (
		<svg
			width={Math.round((size * 20) / 23)}
			height={size}
			className={className}
			viewBox="0 0 20 23"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
		>
			<title>Text height</title>
			<path
				d="M12.67 18.9194C13.2599 19.5262 14.8297 21.9194 15.67 21.9194C16.5103 21.9194 18.0802 19.5262 18.67 18.9194M12.75 10.9965C13.3398 10.3897 14.9097 7.99653 15.75 7.99653C16.5903 7.99653 18.1602 10.3897 18.75 10.9965M15.6495 21.4965L15.7295 8.12853M7.75 0.75V21.75M7.75 0.75C9.1374 0.75 11.9195 0.78054 13.3384 0.92648C13.9385 0.98819 14.2386 1.01905 14.5041 1.1279C15.0566 1.35428 15.5018 1.85062 15.6694 2.4268C15.75 2.70381 15.75 3.01991 15.75 3.65214M7.75 0.75C6.3626 0.75 4.58047 0.78054 3.16161 0.92648C2.5615 0.98819 2.26144 1.01905 1.99586 1.1279C1.44344 1.35428 0.99816 1.85062 0.83057 2.4268C0.75 2.70381 0.75 3.01991 0.75 3.65214"
				stroke="currentColor"
				strokeWidth="1.5"
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

export function OcShapesIcon({
	className = "",
	size = 32,
	strokeWidth = 1.5,
}: IconProps) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden
			className={className}
		>
			<title>Shapes</title>
			<defs>
				<clipPath id="clip" clipPathUnits="userSpaceOnUse">
					<path d="M0 0H24V24H0ZM8 8H24V24H8Z" clipRule="evenodd" />
				</clipPath>
			</defs>
			<circle
				cx="8.5"
				cy="8.5"
				r="7.75"
				stroke="currentColor"
				strokeWidth={strokeWidth}
				clipPath="url(#clip)"
			/>
			<rect
				x="8.75"
				y="8.75"
				width="14.5"
				height="14.5"
				stroke="currentColor"
				strokeWidth={strokeWidth}
			/>
		</svg>
	);
}

export function OcMirrorIcon({
	className = "",
	size = 32,
}: IconProps) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden
			className={className}
		>
			<title>Mirror</title>
			<g clipPath="url(#clip0_5_41)">
				<path
					d="M12 23.2242C5.8043 23.2242 0.7817 18.2016 0.7817 12.0059C0.7817 5.81026 5.8043 0.787682 12 0.787682C18.1957 0.787682 23.2183 5.81026 23.2183 12.0059C23.2183 18.2016 18.1957 23.2242 12 23.2242Z"
					stroke="black"
					strokeWidth="1.5"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
				<path
					d="M12 0.787682C14.9752 0.787682 17.8287 1.9696 19.9325 4.07343C22.0363 6.17726 23.2182 9.03067 23.2182 12.0059C23.2182 14.9812 22.0363 17.8346 19.9325 19.9384C17.8287 22.0423 14.9752 23.2242 12 23.2242V0.787682Z"
					fill="black"
				/>
			</g>
			<defs>
				<clipPath id="clip0_5_41">
					<rect width="24" height="24" fill="white" />
				</clipPath>
			</defs>
		</svg>
	);
}

export function OcSquarePlusIcon({
	className = "",
	size = 32,
	strokeWidth = 1.5,
}: IconProps) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden
			className={className}
		>
			<title>Square Plus</title>
			<defs>
				<mask id="frameMask" maskUnits="userSpaceOnUse">
					<rect width="24" height="24" fill="white" />
					<rect x="14.636" y="14.636" width="9.364" height="9.364" fill="black" />
				</mask>
				<clipPath id="plusClip" clipPathUnits="userSpaceOnUse">
					<rect x="16" y="16" width="9" height="8" />
				</clipPath>
			</defs>
			<rect
				x="0.923"
				y="0.923"
				width="22.154"
				height="22.154"
				rx="2.769"
				stroke="currentColor"
				strokeWidth={strokeWidth}
				mask="url(#frameMask)"
			/>
			<rect
				x="19.493"
				y="16.486"
				width="1.503"
				height="7.514"
				fill="currentColor"
				clipPath="url(#plusClip)"
			/>
			<rect
				x="16.487"
				y="19.492"
				width="7.514"
				height="1.503"
				fill="currentColor"
				clipPath="url(#plusClip)"
			/>
		</svg>
	);
}

export function OcRippleIcon({
	className = "",
	size = 24,
	strokeWidth = 1.5,
}: IconProps) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 24 24"
			fill="none"
			xmlns="http://www.w3.org/2000/svg"
			aria-hidden
			className={className}
		>
			<title>Ripple</title>
			<path
				d="M5 9C4.39316 9.58984 2 11.1597 2 12C2 12.8403 4.39316 14.4102 5 15"
				stroke="currentColor"
				strokeWidth={strokeWidth}
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
			<path
				d="M19 9C19.6068 9.58984 22 11.1597 22 12C22 12.8403 19.6068 14.4102 19 15"
				stroke="currentColor"
				strokeWidth={strokeWidth}
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
			<path
				d="M2.42285 11.9795H21.868"
				stroke="currentColor"
				strokeWidth={strokeWidth}
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
			<path
				d="M12.1454 21.7021L12.1454 2.25692"
				stroke="currentColor"
				strokeWidth={strokeWidth}
				strokeLinecap="round"
				strokeLinejoin="round"
			/>
		</svg>
	);
}

